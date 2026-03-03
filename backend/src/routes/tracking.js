const express = require('express');
const db = require('../database');
const transporter = require('../services/relayTransporter');
const config = require('../config');

const router = express.Router();

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// GET /t/open/:trackingId - tracking pixel
router.get('/open/:trackingId', async (req, res) => {
  const { trackingId } = req.params;
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.end(PIXEL);

  // Async update (don't await)
  setImmediate(async () => {
    try {
      const { rows } = await db.query(
        'SELECT id, opened FROM emails WHERE tracking_id=$1',
        [trackingId]
      );
      if (!rows[0]) return;
      const email = rows[0];

      await db.query(
        `UPDATE emails SET
          opened = true,
          opened_at = COALESCE(opened_at, NOW()),
          opened_count = opened_count + 1
        WHERE tracking_id = $1`,
        [trackingId]
      );

      await db.query(
        `INSERT INTO email_events (email_id, event_type, ip_address, user_agent, data)
         VALUES ($1, 'opened', $2, $3, $4)`,
        [
          email.id,
          req.ip || null,
          req.headers['user-agent'] || null,
          JSON.stringify({ referer: req.headers.referer }),
        ]
      );
    } catch (e) {}
  });
});

// GET /t/click/:trackingId - link click tracking
router.get('/click/:trackingId', async (req, res) => {
  const { trackingId } = req.params;
  const { url } = req.query;

  if (!url) return res.status(400).send('Missing url');

  // Redirect immediately
  res.redirect(302, decodeURIComponent(url));

  setImmediate(async () => {
    try {
      const { rows } = await db.query(
        'SELECT id FROM emails WHERE tracking_id=$1',
        [trackingId]
      );
      if (!rows[0]) return;

      await db.query(
        `UPDATE emails SET
          clicked = true,
          clicked_at = COALESCE(clicked_at, NOW()),
          click_count = click_count + 1
        WHERE tracking_id = $1`,
        [trackingId]
      );

      await db.query(
        `INSERT INTO email_events (email_id, event_type, ip_address, user_agent, data)
         VALUES ($1, 'clicked', $2, $3, $4)`,
        [
          rows[0].id,
          req.ip || null,
          req.headers['user-agent'] || null,
          JSON.stringify({ url: decodeURIComponent(url) }),
        ]
      );
    } catch (e) {}
  });
});

// POST /t/bounce - bounce webhook (called by Postfix script)
router.post('/bounce', async (req, res) => {
  const secret = req.headers['x-bounce-secret'];
  if (secret !== process.env.BOUNCE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { tracking_id, bounce_type, bounce_message } = req.body;
  if (!tracking_id) return res.status(400).json({ error: 'Missing tracking_id' });

  try {
    const { rows } = await db.query(
      `UPDATE emails SET
        status = 'bounced',
        bounced = true,
        bounced_at = NOW(),
        bounce_type = $2,
        bounce_message = $3
      WHERE tracking_id = $1 RETURNING id`,
      [tracking_id, bounce_type || 'hard', bounce_message || '']
    );

    if (rows[0]) {
      await db.query(
        `INSERT INTO email_events (email_id, event_type, data)
         VALUES ($1, 'bounced', $2)`,
        [rows[0].id, JSON.stringify({ bounce_type, bounce_message })]
      );

      // Aggiungi in suppression list su hard bounce
      if ((bounce_type || 'hard') === 'hard') {
        const { rows: emailData } = await db.query(
          'SELECT to_addresses FROM emails WHERE id=$1', [rows[0].id]
        );
        const toAddr = emailData[0]?.to_addresses;
        if (toAddr) {
          await db.query(
            `INSERT INTO suppression_list (email, reason, bounce_message)
             VALUES ($1, 'hard_bounce', $2) ON CONFLICT (email) DO NOTHING`,
            [toAddr.split(',')[0].trim().toLowerCase(), bounce_message || '']
          );
        }
      }

      // Notifica il mittente solo per hard bounce
      if ((bounce_type || 'hard') === 'hard') {
        setImmediate(async () => {
          try {
            const [{ rows: emailRows }, { rows: settingsRows }] = await Promise.all([
              db.query('SELECT from_address, to_addresses, subject FROM emails WHERE id=$1', [rows[0].id]),
              db.query("SELECT key, value FROM app_settings WHERE key IN ('bounce_notification_subject','bounce_notification_body')"),
            ]);
            const email = emailRows[0];
            if (!email || !email.from_address) return;

            const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
            const noreply = `noreply@${config.smtp.hostname}`;
            const reason = bounce_message || 'Indirizzo inesistente o casella piena.';

            const vars = {
              '{to}': email.to_addresses || '',
              '{subject}': email.subject || '(nessun oggetto)',
              '{reason}': reason,
            };
            const replace = (tpl) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(k, v), tpl);

            const notifySubject = replace(
              settings.bounce_notification_subject || 'Mancata consegna: {subject}'
            );
            const notifyBody = replace(
              settings.bounce_notification_body ||
              'La tua email non è stata consegnata a: {to}\nOggetto: {subject}\n\nMotivo: {reason}\n\nQuesto è un messaggio automatico, non rispondere.'
            );

            await transporter.sendMail({
              envelope: { from: noreply, to: email.from_address },
              from: `Mail Delivery <${noreply}>`,
              to: email.from_address,
              subject: notifySubject,
              text: notifyBody,
            });
          } catch (e) {
            // Non blocca il flusso principale
          }
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /t/spam - spam complaint webhook
router.post('/spam', async (req, res) => {
  const secret = req.headers['x-bounce-secret'];
  if (secret !== process.env.BOUNCE_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { tracking_id } = req.body;
  if (!tracking_id) return res.status(400).json({ error: 'Missing tracking_id' });

  try {
    const { rows } = await db.query(
      `UPDATE emails SET status='spam', spam_reported=true, spam_at=NOW()
       WHERE tracking_id=$1 RETURNING id`,
      [tracking_id]
    );

    if (rows[0]) {
      await db.query(
        `INSERT INTO email_events (email_id, event_type, data) VALUES ($1, 'spam', '{}')`,
        [rows[0].id]
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
