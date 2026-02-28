const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const config = require('../config');
const { registerDomainDkim, removeDomainDkim } = require('../services/dkimManager');

const router = express.Router();
router.use(authenticate);

// GET /api/user/dashboard
router.get('/dashboard', async (req, res) => {
  const userId = req.user.id;
  try {
    const yearMonth = new Date().toISOString().slice(0, 7);

    const [usage, pkg, stats, recentEmails, trend] = await Promise.all([
      db.query('SELECT * FROM monthly_usage WHERE user_id=$1 AND year_month=$2', [userId, yearMonth]),
      db.query('SELECT * FROM packages WHERE id=(SELECT package_id FROM users WHERE id=$1)', [userId]),
      db.query(`
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN status='sent' OR status='delivered' THEN 1 END) as sent,
          COUNT(CASE WHEN opened THEN 1 END) as opened,
          COUNT(CASE WHEN bounced THEN 1 END) as bounced,
          COUNT(CASE WHEN spam_reported THEN 1 END) as spam,
          COUNT(CASE WHEN created_at > NOW()-INTERVAL'24h' THEN 1 END) as today
        FROM emails WHERE user_id=$1 AND created_at > NOW()-INTERVAL'30d'
      `, [userId]),
      db.query(`
        SELECT id, from_address, to_addresses, subject, status, opened, bounced, spam_reported, created_at
        FROM emails WHERE user_id=$1
        ORDER BY created_at DESC LIMIT 10
      `, [userId]),
      db.query(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM emails WHERE user_id=$1 AND created_at > NOW()-INTERVAL'30d'
        GROUP BY DATE(created_at) ORDER BY date
      `, [userId]),
    ]);

    const monthlyUsed = parseInt(usage.rows[0]?.email_count || 0);
    const monthlyLimit = pkg.rows[0]?.monthly_limit || 1000;
    const s = stats.rows[0];

    res.json({
      usage: { used: monthlyUsed, limit: monthlyLimit, percentage: Math.round(monthlyUsed / monthlyLimit * 100) },
      package: pkg.rows[0],
      stats: {
        total: parseInt(s.total),
        sent: parseInt(s.sent),
        opened: parseInt(s.opened),
        bounced: parseInt(s.bounced),
        spam: parseInt(s.spam),
        today: parseInt(s.today),
        openRate: s.total > 0 ? (s.opened / s.total * 100).toFixed(1) : 0,
        bounceRate: s.total > 0 ? (s.bounced / s.total * 100).toFixed(1) : 0,
      },
      recentEmails: recentEmails.rows,
      trend: trend.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: legge il record SPF configurato dall'admin (con fallback)
async function getSpfRecord() {
  const res = await db.query("SELECT value FROM branding_settings WHERE key='spf_record'");
  return res.rows[0]?.value || `v=spf1 include:_spf.${config.smtp.hostname} ~all`;
}

// GET /api/user/credentials
router.get('/credentials', async (req, res) => {
  try {
    const [userRes, spfRecord] = await Promise.all([
      db.query('SELECT smtp_username, smtp_password FROM users WHERE id=$1', [req.user.id]),
      getSpfRecord(),
    ]);
    res.json({
      smtp_host: config.smtp.hostname,
      smtp_port: config.smtp.port,
      smtp_port_ssl: config.smtp.portSSL,
      smtp_username: userRes.rows[0].smtp_username,
      smtp_password: userRes.rows[0].smtp_password,
      smtp_encryption: 'STARTTLS/SSL',
      spf_record: spfRecord,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/credentials/reset
router.post('/credentials/reset', async (req, res) => {
  const newPass = crypto.randomBytes(16).toString('base64url');
  try {
    const { rows } = await db.query(
      'UPDATE users SET smtp_password=$1, updated_at=NOW() WHERE id=$2 RETURNING smtp_username, smtp_password',
      [newPass, req.user.id]
    );
    res.json({
      smtp_host: config.smtp.hostname,
      smtp_port: config.smtp.port,
      smtp_username: rows[0].smtp_username,
      smtp_password: rows[0].smtp_password,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/emails
router.get('/emails', async (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;
  const offset = (page - 1) * limit;
  const conditions = ['user_id=$1'];
  const params = [req.user.id];

  if (status) { params.push(status); conditions.push(`status=$${params.length}`); }
  if (search) { params.push(`%${search}%`); conditions.push(`(subject ILIKE $${params.length} OR to_addresses ILIKE $${params.length})`); }

  params.push(limit, offset);
  try {
    const { rows } = await db.query(`
      SELECT id, from_address, from_name, to_addresses, subject, status,
             opened, opened_at, opened_count, bounced, bounced_at, bounce_type,
             spam_reported, clicked, click_count, created_at
      FROM emails WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const count = await db.query(
      `SELECT COUNT(*) FROM emails WHERE ${conditions.join(' AND ')}`,
      params.slice(0, -2)
    );

    res.json({ emails: rows, total: parseInt(count.rows[0].count), page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/emails/:id
router.get('/emails/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM emails WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Email non trovata' });

    const events = await db.query(
      'SELECT * FROM email_events WHERE email_id=$1 ORDER BY created_at',
      [req.params.id]
    );
    res.json({ ...rows[0], events: events.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DOMAINS ──────────────────────────────────────────────────

// GET /api/user/domains
router.get('/domains', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, domain, status, spf_verified, dkim_verified, mx_verified, dkim_selector, dkim_public_key, verification_token, created_at FROM domains WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/domains
router.post('/domains', async (req, res) => {
  const { domain } = req.body;
  if (!domain || !/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(domain)) {
    return res.status(400).json({ error: 'Dominio non valido' });
  }

  try {
    // Generate DKIM keypair
    let dkimPublicKey = '', dkimPrivateKey = '', selector = 'smtpflow';
    try {
      const { generateKeyPairSync } = require('crypto');
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      // OpenDKIM richiede formato PKCS#1 (RSA tradizionale)
      dkimPrivateKey = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
      const pubKeyDer = publicKey.export({ type: 'spki', format: 'der' });
      dkimPublicKey = pubKeyDer.toString('base64');
    } catch (e) {
      dkimPublicKey = 'generation-failed';
    }

    const verificationToken = crypto.randomBytes(16).toString('hex');

    const [{ rows }, spfRecord] = await Promise.all([
      db.query(
        `INSERT INTO domains (user_id, domain, dkim_selector, dkim_public_key, dkim_private_key, verification_token)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, domain, status, dkim_selector, dkim_public_key, verification_token, created_at`,
        [req.user.id, domain.toLowerCase(), selector, dkimPublicKey, dkimPrivateKey, verificationToken]
      ),
      getSpfRecord(),
    ]);

    res.status(201).json({
      ...rows[0],
      dns_records: getDnsRecords(domain, rows[0], spfRecord),
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Dominio già aggiunto' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user/domains/:id/verify
router.post('/domains/:id/verify', async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM domains WHERE id=$1 AND user_id=$2',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Dominio non trovato' });

  const domain = rows[0];
  const dns = require('dns').promises;

  let spfVerified = false, dkimVerified = false, mxVerified = false;

  try {
    // Check SPF
    const txtRecords = await dns.resolveTxt(domain.domain).catch(() => []);
    spfVerified = txtRecords.some(r => r.join('').includes('v=spf1'));

    // Check MX
    const mxRecords = await dns.resolveMx(domain.domain).catch(() => []);
    mxVerified = mxRecords.length > 0;

    // Check DKIM
    try {
      const dkimTxt = await dns.resolveTxt(`${domain.dkim_selector}._domainkey.${domain.domain}`);
      dkimVerified = dkimTxt.some(r => r.join('').includes('v=DKIM1'));
    } catch (e) {
      dkimVerified = false;
    }
  } catch (e) {}

  // SPF è sufficiente per considerare il dominio verificato
  const newStatus = spfVerified ? 'verified' : 'pending';

  const [{ rows: updated }, spfRecord] = await Promise.all([
    db.query(
      'UPDATE domains SET spf_verified=$1, dkim_verified=$2, mx_verified=$3, status=$4, updated_at=NOW() WHERE id=$5 RETURNING *',
      [spfVerified, dkimVerified, mxVerified, newStatus, domain.id]
    ),
    getSpfRecord(),
  ]);

  // Registra chiave DKIM in OpenDKIM quando il dominio è verificato
  if (spfVerified && domain.dkim_private_key) {
    await registerDomainDkim(domain.domain, domain.dkim_private_key);
  }

  res.json({ ...updated[0], dns_records: getDnsRecords(domain.domain, updated[0], spfRecord) });
});

// GET /api/user/domains/:id/dns
router.get('/domains/:id/dns', async (req, res) => {
  const [{ rows }, spfRecord] = await Promise.all([
    db.query('SELECT * FROM domains WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]),
    getSpfRecord(),
  ]);
  if (!rows[0]) return res.status(404).json({ error: 'Dominio non trovato' });
  res.json({ dns_records: getDnsRecords(rows[0].domain, rows[0], spfRecord) });
});

// DELETE /api/user/domains/:id
router.delete('/domains/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'DELETE FROM domains WHERE id=$1 AND user_id=$2 RETURNING domain',
      [req.params.id, req.user.id]
    );
    if (rows[0]) await removeDomainDkim(rows[0].domain);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getDnsRecords(domain, domainRow, spfRecord) {
  return [
    {
      type: 'TXT',
      host: '@',
      value: spfRecord || `v=spf1 include:_spf.${config.smtp.hostname} ~all`,
      description: 'SPF — autorizza il server ad inviare email per questo dominio',
      required: true,
    },
  ];
}

module.exports = router;
