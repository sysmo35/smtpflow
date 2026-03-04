/**
 * HTTP API for sending emails (alternative to direct SMTP)
 */
const express = require('express');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db = require('../database');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const relayTransporter = require('../services/relayTransporter');

const router = express.Router();
router.use(authenticate);

function injectTracking(html, trackingId) {
  if (!html) return html;
  try {
    const $ = cheerio.load(html);
    const base = config.app.baseUrl;
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('http')) {
        $(el).attr('href', `${base}/t/click/${trackingId}?url=${encodeURIComponent(href)}`);
      }
    });
    const pixel = `<img src="${base}/t/open/${trackingId}" width="1" height="1" style="display:none" alt="" />`;
    if ($('body').length) $('body').append(pixel);
    else return $.html() + pixel;
    return $.html();
  } catch (e) { return html; }
}

async function checkAndIncrementUsage(workspaceId, userId, packageId) {
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

  if (used >= limit) throw Object.assign(new Error(`Limite mensile raggiunto (${used}/${limit})`), { status: 429 });
  if (pkg.rows[0]?.daily_limit && dailyCount >= pkg.rows[0].daily_limit)
    throw Object.assign(new Error(`Limite giornaliero raggiunto (${dailyCount}/${pkg.rows[0].daily_limit})`), { status: 429 });
  if (pkg.rows[0]?.hourly_limit && hourlyCount >= pkg.rows[0].hourly_limit)
    throw Object.assign(new Error(`Limite orario raggiunto (${hourlyCount}/${pkg.rows[0].hourly_limit})`), { status: 429 });

  await db.query(
    `INSERT INTO monthly_usage (workspace_id, user_id, year_month, email_count) VALUES ($1,$2,$3,1)
     ON CONFLICT (workspace_id, year_month) DO UPDATE SET email_count = monthly_usage.email_count + 1`,
    [workspaceId, userId, yearMonth]
  );
  return { used: used + 1, limit };
}

// POST /api/send
router.post('/',
  body('to').notEmpty(),
  body('subject').notEmpty(),
  body('from').optional().isEmail(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { to, from, from_name, subject, html, text, reply_to } = req.body;
    const workspace = req.workspace;

    try {
      if (workspace.status !== 'active') return res.status(403).json({ error: 'Account sospeso' });

      await checkAndIncrementUsage(workspace.id, req.user.id, workspace.package_id);

      const toAddresses = Array.isArray(to) ? to : [to];

      // Check suppression list
      const suppressed = await db.query(
        'SELECT email FROM suppression_list WHERE LOWER(email) = ANY($1::text[])',
        [toAddresses.map(a => a.toLowerCase())]
      );
      if (suppressed.rows.length > 0) {
        return res.status(422).json({
          error: `Indirizzo in suppression list: ${suppressed.rows.map(r => r.email).join(', ')}`,
        });
      }

      const trackingId = uuidv4().replace(/-/g, '');
      const fromAddress = from || `${workspace.smtp_username}@${config.smtp.hostname}`;
      const fromDisplay = from_name ? `"${from_name}" <${fromAddress}>` : fromAddress;
      const bounceAddress = `bounce+${trackingId}@${config.smtp.hostname}`;

      const trackedHtml = html ? injectTracking(html, trackingId) : undefined;

      await relayTransporter.sendMail({
        envelope: { from: bounceAddress, to: toAddresses },
        from: fromDisplay,
        to: toAddresses.join(', '),
        replyTo: reply_to,
        subject,
        text: text || undefined,
        html: trackedHtml || undefined,
        headers: {
          'X-SMTPFlow-ID': trackingId,
          'List-Unsubscribe': `<${config.app.baseUrl}/unsubscribe/${trackingId}>`,
        },
      });

      const { rows } = await db.query(
        `INSERT INTO emails (workspace_id, user_id, from_address, from_name, to_addresses, subject, status, tracking_id, size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6,'delivered',$7,$8) RETURNING id, tracking_id, created_at`,
        [workspace.id, req.user.id, fromAddress, from_name || '', toAddresses.join(', '), subject, trackingId,
         Buffer.byteLength(html || text || '', 'utf8')]
      );

      await db.query(
        'INSERT INTO email_events (email_id, event_type) VALUES ($1, \'delivered\')',
        [rows[0].id]
      );

      res.json({
        success: true,
        email_id: rows[0].id,
        tracking_id: rows[0].tracking_id,
        sent_at: rows[0].created_at,
      });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message });
    }
  }
);

module.exports = router;
