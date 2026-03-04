const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const bcrypt = require('bcryptjs');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const db = require('../database');
const config = require('../config');
const logger = require('../logger');
const relayTransporter = require('./relayTransporter');

function injectTracking(html, trackingId, baseUrl) {
  if (!html) return html;
  try {
    const $ = cheerio.load(html);

    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('http')) {
        const tracked = `${baseUrl}/t/click/${trackingId}?url=${encodeURIComponent(href)}`;
        $(el).attr('href', tracked);
      }
    });

    const pixel = `<img src="${baseUrl}/t/open/${trackingId}" width="1" height="1" style="display:none;visibility:hidden;opacity:0;" alt="" />`;
    if ($('body').length) {
      $('body').append(pixel);
    } else {
      return $.html() + pixel;
    }

    return $.html();
  } catch (e) {
    return html;
  }
}

// Returns a workspace+user merged object for SMTP auth
async function getUserByCredentials(username, password) {
  const { rows } = await db.query(
    `SELECT w.id, w.smtp_username, w.smtp_password, w.package_id, w.status as workspace_status,
            u.id as user_id, u.email, u.name, u.status as user_status
     FROM workspaces w
     JOIN users u ON u.id = w.user_id
     WHERE w.smtp_username = $1`,
    [username]
  );
  if (!rows[0]) return null;
  if (!(await bcrypt.compare(password, rows[0].smtp_password))) return null;
  if (rows[0].user_status !== 'active') return null;
  if (rows[0].workspace_status !== 'active') return null;
  return rows[0];
}

async function checkRateLimit(workspaceId, packageId) {
  const yearMonth = new Date().toISOString().slice(0, 7);

  const [usage, pkg, dailyRes, hourlyRes] = await Promise.all([
    db.query('SELECT email_count FROM monthly_usage WHERE workspace_id=$1 AND year_month=$2', [workspaceId, yearMonth]),
    db.query('SELECT monthly_limit, daily_limit, hourly_limit FROM packages WHERE id=$1', [packageId]),
    db.query('SELECT COUNT(*) as count FROM emails WHERE workspace_id=$1 AND created_at >= CURRENT_DATE', [workspaceId]),
    db.query("SELECT COUNT(*) as count FROM emails WHERE workspace_id=$1 AND created_at >= NOW() - INTERVAL '1 hour'", [workspaceId]),
  ]);

  const used = parseInt(usage.rows[0]?.email_count || 0);
  const limit = pkg.rows[0]?.monthly_limit || 1000;
  const dailyCount = parseInt(dailyRes.rows[0].count);
  const hourlyCount = parseInt(hourlyRes.rows[0].count);

  if (used >= limit) {
    return { allowed: false, reason: `Monthly limit reached (${used}/${limit})` };
  }
  if (pkg.rows[0]?.daily_limit && dailyCount >= pkg.rows[0].daily_limit) {
    return { allowed: false, reason: `Daily limit reached (${dailyCount}/${pkg.rows[0].daily_limit})` };
  }
  if (pkg.rows[0]?.hourly_limit && hourlyCount >= pkg.rows[0].hourly_limit) {
    return { allowed: false, reason: `Hourly limit reached (${hourlyCount}/${pkg.rows[0].hourly_limit})` };
  }
  return { allowed: true, used, limit };
}

async function incrementUsage(workspaceId, userId) {
  const yearMonth = new Date().toISOString().slice(0, 7);
  await db.query(
    `INSERT INTO monthly_usage (workspace_id, user_id, year_month, email_count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (workspace_id, year_month)
     DO UPDATE SET email_count = monthly_usage.email_count + 1`,
    [workspaceId, userId, yearMonth]
  );
}

function loadTLSOptions() {
  const hostname = config.smtp.hostname;
  const candidates = [
    { cert: process.env.TLS_CERT, key: process.env.TLS_KEY },
    { cert: `/etc/letsencrypt/live/${hostname}/fullchain.pem`, key: `/etc/letsencrypt/live/${hostname}/privkey.pem` },
    { cert: `/opt/smtpflow/ssl/fullchain.pem`, key: `/opt/smtpflow/ssl/privkey.pem` },
  ];
  for (const { cert, key } of candidates) {
    if (!cert || !key) continue;
    try {
      const certData = fs.readFileSync(cert);
      const keyData  = fs.readFileSync(key);
      logger.info(`SMTP TLS: using cert from ${cert}`);
      return { cert: certData, key: keyData, minVersion: 'TLSv1.2' };
    } catch (e) {
      // try next candidate
    }
  }
  logger.warn('SMTP TLS: no cert found, using self-signed (TLS may not work correctly)');
  return { minVersion: 'TLSv1.2' };
}

function createSMTPServer(port, secure = false) {
  const tlsOpts = loadTLSOptions();
  const server = new SMTPServer({
    name: config.smtp.hostname,
    banner: 'SMTPFlow Mail Server',
    secure,
    needsUpgrade: !secure,
    authMethods: ['PLAIN', 'LOGIN'],
    allowInsecureAuth: false,
    disabledCommands: secure ? [] : [],
    ...tlsOpts,

    onAuth(auth, session, callback) {
      const username = auth.username || (auth.credentials && auth.credentials.username);
      const password = auth.password || (auth.credentials && auth.credentials.password);
      getUserByCredentials(username, password)
        .then(ws => {
          if (!ws) {
            return callback(new Error('Invalid credentials'));
          }
          session.smtpWorkspace = ws;
          callback(null, { user: ws.id });
        })
        .catch(err => callback(err));
    },

    onMailFrom(address, session, callback) {
      if (!session.smtpWorkspace) return callback(new Error('Not authenticated'));
      callback();
    },

    onRcptTo(address, session, callback) {
      callback();
    },

    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', async () => {
        const raw = Buffer.concat(chunks);

        try {
          const ws = session.smtpWorkspace;
          if (!ws) return callback(new Error('Not authenticated'));

          // Rate limit check
          const rateCheck = await checkRateLimit(ws.id, ws.package_id);
          if (!rateCheck.allowed) {
            return callback(new Error(rateCheck.reason));
          }

          // Parse email
          const parsed = await simpleParser(raw);

          const trackingId = uuidv4().replace(/-/g, '');
          const baseUrl = config.app.baseUrl;

          // Inject tracking into HTML
          let htmlContent = parsed.html || null;
          if (htmlContent) {
            htmlContent = injectTracking(htmlContent, trackingId, baseUrl);
          }

          const bounceAddress = `bounce+${trackingId}@${config.smtp.hostname}`;
          const toAddresses = session.envelope.rcptTo.map(r => r.address);

          const mailOptions = {
            envelope: {
              from: bounceAddress,
              to: toAddresses,
            },
            from: parsed.from?.text || session.envelope.mailFrom.address,
            to: toAddresses.join(', '),
            subject: parsed.subject || '',
            text: parsed.text || undefined,
            html: htmlContent || undefined,
            headers: {
              'X-SMTPFlow-ID': trackingId,
              'X-Mailer': 'SMTPFlow',
              'List-Unsubscribe': `<${baseUrl}/unsubscribe/${trackingId}>`,
            },
          };

          await relayTransporter.sendMail(mailOptions);

          // Log to database
          const emailRecord = await db.query(
            `INSERT INTO emails
              (workspace_id, user_id, from_address, from_name, to_addresses, subject, status, tracking_id, size_bytes, ip_address)
             VALUES ($1,$2,$3,$4,$5,$6,'delivered',$7,$8,$9) RETURNING id`,
            [
              ws.id,
              ws.user_id,
              session.envelope.mailFrom.address,
              parsed.from?.value?.[0]?.name || '',
              toAddresses.join(', '),
              parsed.subject || '',
              trackingId,
              raw.length,
              session.remoteAddress || null,
            ]
          );

          await db.query(
            `INSERT INTO email_events (email_id, event_type, ip_address)
             VALUES ($1, 'delivered', $2)`,
            [emailRecord.rows[0].id, session.remoteAddress || null]
          );

          await incrementUsage(ws.id, ws.user_id);

          logger.info(`Email sent: ${trackingId} from ${ws.email} to ${toAddresses.join(', ')}`);
          callback();
        } catch (err) {
          logger.error('SMTP onData error', err);
          callback(new Error('Internal server error'));
        }
      });
    },

    onError(err) {
      logger.error('SMTP server error', err);
    },
  });

  server.on('error', err => logger.error(`SMTP server (port ${port}) error:`, err));
  return server;
}

function startSMTPServers() {
  const starttlsServer = createSMTPServer(config.smtp.port, false);
  starttlsServer.listen(config.smtp.port, config.app.host, () => {
    logger.info(`SMTP STARTTLS server listening on port ${config.smtp.port}`);
  });

  const sslServer = createSMTPServer(config.smtp.portSSL, true);
  sslServer.listen(config.smtp.portSSL, config.app.host, () => {
    logger.info(`SMTP SSL server listening on port ${config.smtp.portSSL}`);
  });

  return { starttlsServer, sslServer };
}

module.exports = { startSMTPServers };
