/**
 * Provisioning API — used by WHMCS (and any external billing system).
 *
 * Auth: X-Provision-Key header must match PROVISION_API_KEY (DB or env).
 *
 * Endpoints:
 *   GET  /api/provision/packages          — list available packages
 *   POST /api/provision/create            — find/create user + create workspace
 *   POST /api/provision/suspend           — suspend workspace (by service_id or email)
 *   POST /api/provision/unsuspend         — reactivate workspace
 *   POST /api/provision/terminate         — delete workspace; delete user if no workspaces left
 *   POST /api/provision/changepackage     — change workspace package
 *   GET  /api/provision/info?email=...    — account info
 *   POST /api/provision/sso               — generate SSO token (includes workspace_id)
 */

const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../database');
const config  = require('../config');
const logger  = require('../logger');

const router = express.Router();

// ── Auth middleware ──────────────────────────────────────────
async function getProvisionKey() {
  try {
    const { rows } = await db.query(
      "SELECT value FROM app_settings WHERE key='provision_api_key'"
    );
    if (rows[0]?.value) return rows[0].value;
  } catch (_) { /* ignore, use env */ }
  return process.env.PROVISION_API_KEY || '';
}

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
  const { email, service_id } = req.query;
  try {
    if (service_id) {
      const { rows } = await db.query(
        `SELECT w.id as workspace_id, w.smtp_username, w.status, w.whmcs_service_id, w.created_at,
                u.id, u.email, u.name,
                p.name as package_name, p.monthly_limit
         FROM workspaces w
         JOIN users u ON u.id = w.user_id
         LEFT JOIN packages p ON p.id = w.package_id
         WHERE w.whmcs_service_id = $1`,
        [service_id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Workspace not found' });
      res.json(rows[0]);
    } else if (email) {
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.name, u.status, u.created_at,
                (SELECT COUNT(*) FROM workspaces w WHERE w.user_id = u.id) as workspace_count
         FROM users u WHERE u.email=$1 AND u.role='user'`,
        [email]
      );
      if (!rows[0]) return res.status(404).json({ error: 'User not found' });
      res.json(rows[0]);
    } else {
      return res.status(400).json({ error: 'email or service_id query param required' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/create ───────────────────────────────
// Pattern: find-or-create user, ALWAYS create new workspace.
router.post('/create', async (req, res) => {
  const { email, name, package_id, service_id, workspace_name } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'email and name are required' });

  try {
    // 1. Find or create user
    let userId, webPassword = null;
    const existingUser = await db.query(
      "SELECT id FROM users WHERE email=$1 AND role='user'",
      [email]
    );

    if (existingUser.rows[0]) {
      userId = existingUser.rows[0].id;
      logger.info(`Provision create: found existing user ${email}`);
    } else {
      // New user — generate web password and placeholder smtp credentials
      webPassword = crypto.randomBytes(12).toString('base64url');
      const webPasswordHash = await bcrypt.hash(webPassword, 12);
      // smtp_username on users table is still required by schema during transition period
      const placeholderSmtp = 'smtp_' + crypto.randomBytes(6).toString('hex');
      const placeholderSmtpHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);

      const { rows } = await db.query(
        `INSERT INTO users (email, name, password_hash, smtp_username, smtp_password, role, status)
         VALUES ($1,$2,$3,$4,$5,'user','active') RETURNING id`,
        [email, name, webPasswordHash, placeholderSmtp, placeholderSmtpHash]
      );
      userId = rows[0].id;
      logger.info(`Provision create: created new user ${email}`);
    }

    // 2. Create workspace
    const wsSmtpUsername = 'smtp_' + crypto.randomBytes(6).toString('hex');
    const wsSmtpPassword = crypto.randomBytes(16).toString('base64url');
    const wsSmtpPasswordHash = await bcrypt.hash(wsSmtpPassword, 10);

    const wsName = workspace_name || (service_id ? `Service #${service_id}` : 'Workspace');
    const { rows: wsRows } = await db.query(
      `INSERT INTO workspaces (user_id, name, smtp_username, smtp_password, package_id, status, whmcs_service_id)
       VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING id`,
      [userId, wsName, wsSmtpUsername, wsSmtpPasswordHash, package_id || null, service_id || null]
    );
    const workspaceId = wsRows[0].id;
    logger.info(`Provision create: workspace ${workspaceId} for user ${email} (service_id=${service_id})`);

    res.json({
      success: true,
      user_id: userId,
      workspace_id: workspaceId,
      email,
      smtp_host:     config.smtp.hostname,
      smtp_port:     config.smtp.port,
      smtp_port_ssl: config.smtp.portSSL,
      smtp_username: wsSmtpUsername,
      smtp_password: wsSmtpPassword,
      web_password:  webPassword,  // null if user already existed
      dashboard_url: config.app.baseUrl,
    });
  } catch (err) {
    logger.error('Provision create error', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/suspend ──────────────────────────────
router.post('/suspend', async (req, res) => {
  const { email, service_id } = req.body;
  try {
    if (service_id) {
      const { rows } = await db.query(
        "UPDATE workspaces SET status='suspended', updated_at=NOW() WHERE whmcs_service_id=$1 RETURNING id",
        [service_id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Workspace not found for service_id' });
      logger.info(`Provision: suspended workspace service_id=${service_id}`);
    } else if (email) {
      // Backward compat: suspend all workspaces for user
      const user = await db.query("SELECT id FROM users WHERE email=$1 AND role='user'", [email]);
      if (!user.rows[0]) return res.status(404).json({ error: 'User not found' });
      await db.query(
        "UPDATE workspaces SET status='suspended', updated_at=NOW() WHERE user_id=$1",
        [user.rows[0].id]
      );
      logger.info(`Provision: suspended all workspaces for ${email}`);
    } else {
      return res.status(400).json({ error: 'service_id or email is required' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/unsuspend ────────────────────────────
router.post('/unsuspend', async (req, res) => {
  const { email, service_id } = req.body;
  try {
    if (service_id) {
      const { rows } = await db.query(
        "UPDATE workspaces SET status='active', updated_at=NOW() WHERE whmcs_service_id=$1 RETURNING id",
        [service_id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Workspace not found for service_id' });
      logger.info(`Provision: unsuspended workspace service_id=${service_id}`);
    } else if (email) {
      const user = await db.query("SELECT id FROM users WHERE email=$1 AND role='user'", [email]);
      if (!user.rows[0]) return res.status(404).json({ error: 'User not found' });
      await db.query(
        "UPDATE workspaces SET status='active', updated_at=NOW() WHERE user_id=$1",
        [user.rows[0].id]
      );
      logger.info(`Provision: unsuspended all workspaces for ${email}`);
    } else {
      return res.status(400).json({ error: 'service_id or email is required' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/terminate ────────────────────────────
router.post('/terminate', async (req, res) => {
  const { email, service_id } = req.body;
  try {
    if (service_id) {
      const { rows } = await db.query(
        'DELETE FROM workspaces WHERE whmcs_service_id=$1 RETURNING user_id',
        [service_id]
      );
      if (!rows[0]) {
        logger.info(`Provision: terminate — workspace not found for service_id=${service_id}`);
        return res.json({ success: true }); // idempotent
      }
      const userId = rows[0].user_id;
      // If no workspaces remain, delete the user
      const remaining = await db.query('SELECT COUNT(*) FROM workspaces WHERE user_id=$1', [userId]);
      if (parseInt(remaining.rows[0].count) === 0) {
        await db.query("DELETE FROM users WHERE id=$1 AND role='user'", [userId]);
        logger.info(`Provision: terminated workspace and deleted user (service_id=${service_id})`);
      } else {
        logger.info(`Provision: terminated workspace service_id=${service_id} (user has other workspaces)`);
      }
    } else if (email) {
      // Backward compat: delete user entirely
      await db.query("DELETE FROM users WHERE email=$1 AND role='user'", [email]);
      logger.info(`Provision: terminated user ${email}`);
    } else {
      return res.status(400).json({ error: 'service_id or email is required' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/changepackage ────────────────────────
router.post('/changepackage', async (req, res) => {
  const { email, package_id, service_id } = req.body;
  if (!package_id) return res.status(400).json({ error: 'package_id is required' });
  try {
    if (service_id) {
      const { rows } = await db.query(
        'UPDATE workspaces SET package_id=$1, updated_at=NOW() WHERE whmcs_service_id=$2 RETURNING id',
        [package_id, service_id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Workspace not found for service_id' });
      logger.info(`Provision: changepackage service_id=${service_id} -> ${package_id}`);
    } else if (email) {
      const user = await db.query("SELECT id FROM users WHERE email=$1 AND role='user'", [email]);
      if (!user.rows[0]) return res.status(404).json({ error: 'User not found' });
      await db.query(
        'UPDATE workspaces SET package_id=$1, updated_at=NOW() WHERE user_id=$2',
        [package_id, user.rows[0].id]
      );
      logger.info(`Provision: changepackage ${email} -> ${package_id}`);
    } else {
      return res.status(400).json({ error: 'service_id or email is required' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/sso ──────────────────────────────────
router.post('/sso', async (req, res) => {
  const { email, service_id } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  try {
    const { rows: userRows } = await db.query(
      "SELECT id, email, name, role, status FROM users WHERE email=$1 AND role='user'",
      [email]
    );
    const user = userRows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Account suspended' });

    // Find workspace: by service_id if provided, else first active workspace
    let workspaceId = null;
    if (service_id) {
      const { rows: wsRows } = await db.query(
        'SELECT id FROM workspaces WHERE whmcs_service_id=$1 AND user_id=$2 AND status=$3',
        [service_id, user.id, 'active']
      );
      workspaceId = wsRows[0]?.id || null;
    }
    if (!workspaceId) {
      const { rows: wsRows } = await db.query(
        'SELECT id FROM workspaces WHERE user_id=$1 AND status=$2 ORDER BY created_at LIMIT 1',
        [user.id, 'active']
      );
      workspaceId = wsRows[0]?.id || null;
    }

    const tokenPayload = { id: user.id, email: user.email, type: 'sso' };
    if (workspaceId) tokenPayload.workspace_id = workspaceId;

    const token = jwt.sign(tokenPayload, config.jwt.secret, { expiresIn: '120s' });

    const redirectUrl = `${config.app.baseUrl}/sso?token=${token}`;
    logger.info(`Provision: SSO token issued for ${email} (workspace_id=${workspaceId})`);
    res.json({ success: true, token, redirect_url: redirectUrl });
  } catch (err) {
    logger.error('Provision SSO error', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/provision/reset-password ───────────────────────
router.post('/reset-password', async (req, res) => {
  const { service_id, email } = req.body;
  try {
    let userId;
    if (service_id) {
      const ws = await db.query(
        'SELECT user_id FROM workspaces WHERE whmcs_service_id=$1',
        [service_id]
      );
      if (!ws.rows[0]) return res.status(404).json({ error: 'Workspace not found' });
      userId = ws.rows[0].user_id;
    } else if (email) {
      const u = await db.query("SELECT id FROM users WHERE email=$1 AND role='user'", [email]);
      if (!u.rows[0]) return res.status(404).json({ error: 'User not found' });
      userId = u.rows[0].id;
    } else {
      return res.status(400).json({ error: 'service_id or email required' });
    }
    const newPassword = crypto.randomBytes(12).toString('base64url');
    const hash = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, userId]);
    logger.info(`Provision: reset web password for user_id=${userId}`);
    res.json({ success: true, web_password: newPassword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/provision/workspace-domains ─────────────────────
router.get('/workspace-domains', async (req, res) => {
  const { service_id } = req.query;
  if (!service_id) return res.status(400).json({ error: 'service_id required' });
  try {
    const ws = await db.query(
      'SELECT id FROM workspaces WHERE whmcs_service_id=$1',
      [service_id]
    );
    if (!ws.rows[0]) return res.status(404).json({ error: 'Workspace not found' });
    const { rows } = await db.query(
      `SELECT domain, spf_verified, dkim_verified, dmarc_verified, created_at
       FROM domains WHERE workspace_id=$1 ORDER BY created_at DESC`,
      [ws.rows[0].id]
    );
    res.json({ success: true, domains: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/provision/workspace-stats ───────────────────────
router.get('/workspace-stats', async (req, res) => {
  const { service_id } = req.query;
  if (!service_id) return res.status(400).json({ error: 'service_id required' });
  try {
    const ws = await db.query(
      "SELECT id FROM workspaces WHERE whmcs_service_id=$1 AND status='active'",
      [service_id]
    );
    if (!ws.rows[0]) return res.status(404).json({ error: 'Workspace not found' });
    const wsId = ws.rows[0].id;
    const yearMonth = new Date().toISOString().slice(0, 7);
    const [domains, usage] = await Promise.all([
      db.query(
        "SELECT COUNT(*) as total, COUNT(CASE WHEN spf_verified THEN 1 END) as verified FROM domains WHERE workspace_id=$1",
        [wsId]
      ),
      db.query(
        "SELECT COALESCE(email_count,0) as count FROM monthly_usage WHERE workspace_id=$1 AND year_month=$2",
        [wsId, yearMonth]
      ),
    ]);
    res.json({
      success: true,
      active_domains: parseInt(domains.rows[0].total),
      verified_domains: parseInt(domains.rows[0].verified),
      emails_month: parseInt(usage.rows[0]?.count || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
