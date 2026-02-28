const express = require('express');
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const config = require('../config');

const DEFAULTS = {
  app_name: 'SMTPFlow',
  logo_url: '',
  primary_color: '#6366f1',
  secondary_color: '#4f46e5',
  support_email: '',
  footer_text: '',
  spf_record: '',
  default_theme: 'auto',
};

async function getBrandingMap() {
  const { rows } = await db.query('SELECT key, value FROM branding_settings');
  const map = { ...DEFAULTS };
  for (const row of rows) map[row.key] = row.value;
  // Fallback dinamico se spf_record non è stato personalizzato
  if (!map.spf_record) {
    map.spf_record = `v=spf1 include:_spf.${config.smtp.hostname} ~all`;
  }
  return map;
}

// GET /api/branding  (pubblica — nessun token)
router.get('/branding', async (req, res) => {
  try {
    res.json(await getBrandingMap());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/branding
router.get('/admin/branding', authenticate, requireAdmin, async (req, res) => {
  try {
    res.json(await getBrandingMap());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/branding
router.put('/admin/branding', authenticate, requireAdmin, async (req, res) => {
  const allowed = ['app_name', 'logo_url', 'primary_color', 'secondary_color', 'support_email', 'footer_text', 'spf_record', 'default_theme'];
  try {
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        await db.query(
          `INSERT INTO branding_settings (key, value)
           VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, String(req.body[key])]
        );
      }
    }
    res.json(await getBrandingMap());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
