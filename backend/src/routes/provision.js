/**
 * Provisioning API — used by WHMCS (and any external billing system).
 *
 * Auth: X-Provision-Key header must match PROVISION_API_KEY (DB or env).
 *
 * Endpoints:
 *   GET  /api/provision/packages          — list available packages
 *   POST /api/provision/create            — create / reactivate account
 *   POST /api/provision/suspend           — suspend account
 *   POST /api/provision/unsuspend         — reactivate account
 *   POST /api/provision/terminate         — delete account
 *   POST /api/provision/changepackage     — change assigned package
 *   GET  /api/provision/info?email=...    — account info
 *   POST /api/provision/sso               — generate SSO token for a user
 */

const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../database');
const config  = require('../config');
const logger  = require('../logger');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────

/**
 * Get PROVISION_API_KEY from DB first, fall back to env.
 */
async function getProvisionKey() {
  try {
    const { rows } = await db.query(
      "SELECT value FROM app_settings WHERE key='provision_api_key'"
    );
    if (rows[0]?.value) return rows[0].value;
  } catch (_) { /* ignore, use env */ }
  return process.env.PROVISION_API_KEY || '';
}

// ── Auth middleware ──────────────────────────────────────────
router.use(async (req, res, next) => {
  const key = req.headers['x-provision-key'];
  const expected = await getProvisionKey();
  if (!expected) {
    return res.status(500).json({ error: 'Provisioning not configured (PROVISION_API_KEY not set)' });
  }
  if (!key || key !== expected) {
    return res.status(401).json({ error: 'Invalid or missing X-Provision-Key' });
  }
  next();
});

// ── GET /api/provision/packages ──────────────────────────────
router.get('/packages', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, monthly_limit, daily_limit, hourly_limit, price FROM packages WHERE is_active=true ORDER BY price ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/provision/info ──────────────────────────────────
router.get('/info', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email query param required' });
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.name, u.status, u.smtp_username, u.created_at,
              p.name as package_name, p.monthly_limit
       FROM users u LEFT JOIN packages p ON p.id = u.package_id
       WHERE u.email=$1 AND u.role='user'`,
      [email]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/create ───────────────────────────────
router.post('/create', async (req, res) => {
  const { email, name, package_id } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'email and name are required' });

  try {
    const existing = await db.query(
      "SELECT id, smtp_username FROM users WHERE email=$1 AND role='user'",
      [email]
    );

    const smtpPassword     = crypto.randomBytes(16).toString('base64url');
    const smtpPasswordHash = await bcrypt.hash(smtpPassword, 10);
    const webPassword      = crypto.randomBytes(12).toString('base64url');
    const webPasswordHash  = await bcrypt.hash(webPassword, 12);

    let smtpUsername, userId;

    if (existing.rows[0]) {
      smtpUsername = existing.rows[0].smtp_username;
      userId = existing.rows[0].id;
      await db.query(
        `UPDATE users SET
           status='active',
           smtp_password=$1,
           password_hash=$2,
           package_id=COALESCE($3, package_id),
           updated_at=NOW()
         WHERE id=$4`,
        [smtpPasswordHash, webPasswordHash, package_id || null, userId]
      );
      logger.info(`Provision: reactivated existing account ${email}`);
    } else {
      smtpUsername = 'smtp_' + crypto.randomBytes(6).toString('hex');
      const { rows } = await db.query(
        `INSERT INTO users (email, name, password_hash, smtp_username, smtp_password, role, package_id, status)
         VALUES ($1,$2,$3,$4,$5,'user',$6,'active') RETURNING id`,
        [email, name, webPasswordHash, smtpUsername, smtpPasswordHash, package_id || null]
      );
      userId = rows[0].id;
      logger.info(`Provision: created new account ${email}`);
    }

    res.json({
      success: true,
      user_id: userId,
      email,
      smtp_host:     config.smtp.hostname,
      smtp_port:     config.smtp.port,
      smtp_port_ssl: config.smtp.portSSL,
      smtp_username: smtpUsername,
      smtp_password: smtpPassword,
      web_password:  webPassword,
      dashboard_url: config.app.baseUrl,
    });
  } catch (err) {
    logger.error('Provision create error', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/suspend ──────────────────────────────
router.post('/suspend', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });
  try {
    const { rows } = await db.query(
      "UPDATE users SET status='suspended', updated_at=NOW() WHERE email=$1 AND role='user' RETURNING id",
      [email]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    logger.info(`Provision: suspended ${email}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/unsuspend ────────────────────────────
router.post('/unsuspend', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });
  try {
    const { rows } = await db.query(
      "UPDATE users SET status='active', updated_at=NOW() WHERE email=$1 AND role='user' RETURNING id",
      [email]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    logger.info(`Provision: unsuspended ${email}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/terminate ────────────────────────────
router.post('/terminate', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });
  try {
    await db.query("DELETE FROM users WHERE email=$1 AND role='user'", [email]);
    logger.info(`Provision: terminated ${email}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/changepackage ────────────────────────
router.post('/changepackage', async (req, res) => {
  const { email, package_id } = req.body;
  if (!email || !package_id) return res.status(400).json({ error: 'email and package_id are required' });
  try {
    const { rows } = await db.query(
      "UPDATE users SET package_id=$1, updated_at=NOW() WHERE email=$2 AND role='user' RETURNING id",
      [package_id, email]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    logger.info(`Provision: changepackage ${email} -> ${package_id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/sso ──────────────────────────────────
// Genera un token SSO a breve scadenza (120s) per auto-login WHMCS.
router.post('/sso', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  try {
    const { rows } = await db.query(
      "SELECT id, email, name, role, status FROM users WHERE email=$1 AND role='user'",
      [email]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Account suspended' });

    const token = jwt.sign(
      { id: user.id, email: user.email, type: 'sso' },
      config.jwt.secret,
      { expiresIn: '120s' }
    );

    const redirectUrl = `${config.app.baseUrl}/sso?token=${token}`;
    logger.info(`Provision: SSO token issued for ${email}`);
    res.json({ success: true, token, redirect_url: redirectUrl });
  } catch (err) {
    logger.error('Provision SSO error', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
