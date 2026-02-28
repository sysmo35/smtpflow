const express = require('express');
const db = require('../database');

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
