const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
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

    // Replace links with tracked versions
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('http')) {
        const tracked = `${baseUrl}/t/click/${trackingId}?url=${encodeURIComponent(href)}`;
        $(el).attr('href', tracked);
      }
    });

    // Inject open tracking pixel before </body>
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

async function getUserByCredentials(username, password) {
  const { rows } = await db.query(
    'SELECT id, email, name, status, package_id, smtp_username, smtp_password FROM users WHERE smtp_username = $1',
    [username]
  );
  if (!rows[0] || rows[0].smtp_password !== password) return null;
  if (rows[0].status !== 'active') return null;
  return rows[0];
}

async function checkRateLimit(userId, packageId) {
  const yearMonth = new Date().toISOString().slice(0, 7);

  const [usage, pkg] = await Promise.all([
    db.query('SELECT email_count FROM monthly_usage WHERE user_id=$1 AND year_month=$2', [userId, yearMonth]),
    db.query('SELECT monthly_limit, daily_limit FROM packages WHERE id=$1', [packageId]),
  ]);

  const used = parseInt(usage.rows[0]?.email_count || 0);
  const limit = pkg.rows[0]?.monthly_limit || 1000;

  if (used >= limit) {
    return { allowed: false, reason: `Monthly limit reached (${used}/${limit})` };
  }
  return { allowed: true, used, limit };
}

async function incrementUsage(userId) {
  const yearMonth = new Date().toISOString().slice(0, 7);
  await db.query(
    `INSERT INTO monthly_usage (user_id, year_month, email_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (user_id, year_month)
     DO UPDATE SET email_count = monthly_usage.email_count + 1`,
    [userId, yearMonth]
  );
}

function loadTLSOptions() {
  const hostname = config.smtp.hostname;
  const certPath = `/etc/letsencrypt/live/${hostname}/fullchain.pem`;
  const keyPath  = `/etc/letsencrypt/live/${hostname}/privkey.pem`;
  try {
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      logger.info(`SMTP TLS: using Let\'s Encrypt cert for ${hostname}`);
      return {
        cert: fs.readFileSync(certPath),
        key:  fs.readFileSync(keyPath),
        minVersion: 'TLSv1.2',
      };
    }
  } catch (e) {
    logger.warn('SMTP TLS: failed to load Let\'s Encrypt cert, using self-signed', e.message);
  }
  logger.warn(`SMTP TLS: cert not found at ${certPath}, using self-signed`);
  return { minVersion: 'TLSv1.2', rejectUnauthorized: false };
}

function createSMTPServer(port, secure = false) {
  const server = new SMTPServer({
    name: config.smtp.hostname,
    banner: 'SMTPFlow Mail Server',
    secure,
    needsUpgrade: !secure,
    authMethods: ['PLAIN', 'LOGIN'],
    allowInsecureAuth: false,
    disabledCommands: secure ? [] : [],
    tls: loadTLSOptions(),

    onAuth(auth, session, callback) {
      const { username, password } = auth.credentials;
      getUserByCredentials(username, password)
        .then(user => {
          if (!user) {
            return callback(new Error('Invalid credentials'));
          }
          session.smtpUser = user;
          callback(null, { user: user.id });
        })
        .catch(err => callback(err));
    },

    onMailFrom(address, session, callback) {
      // Validate sender
      if (!session.smtpUser) return callback(new Error('Not authenticated'));
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
          const user = session.smtpUser;
          if (!user) return callback(new Error('Not authenticated'));

          // Rate limit check
          const rateCheck = await checkRateLimit(user.id, user.package_id);
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

          // Build bounce address
          const bounceAddress = `bounce+${trackingId}@${config.smtp.hostname}`;

          // Prepare recipients
          const toAddresses = session.envelope.rcptTo.map(r => r.address);

          // Send via Postfix
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
              (user_id, from_address, from_name, to_addresses, subject, status, tracking_id, size_bytes, ip_address)
             VALUES ($1,$2,$3,$4,$5,'sent',$6,$7,$8) RETURNING id`,
            [
              user.id,
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
             VALUES ($1, 'sent', $2)`,
            [emailRecord.rows[0].id, session.remoteAddress || null]
          );

          await incrementUsage(user.id);

          logger.info(`Email sent: ${trackingId} from ${user.email} to ${toAddresses.join(', ')}`);
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
