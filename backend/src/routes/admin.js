const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireAdmin);

async function auditLog(adminUser, action, targetType, targetId, details, ip) {
  try {
    await db.query(
      `INSERT INTO audit_logs (admin_id, admin_email, action, target_type, target_id, details, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [adminUser.id, adminUser.email, action, targetType, targetId || null, JSON.stringify(details || {}), ip || null]
    );
  } catch (e) {
    console.error('auditLog error:', e.message);
  }
}

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [users, emails, packages, monthlyEmails, openRate, bounceRate, workspaces] = await Promise.all([
      db.query('SELECT COUNT(*) as total, COUNT(CASE WHEN status=\'active\' THEN 1 END) as active FROM users WHERE role=\'user\''),
      db.query('SELECT COUNT(*) as total, COUNT(CASE WHEN created_at > NOW()-INTERVAL\'24h\' THEN 1 END) as today FROM emails'),
      db.query('SELECT COUNT(*) as total FROM packages WHERE is_active=true'),
      db.query("SELECT COALESCE(SUM(email_count),0) as count FROM monthly_usage WHERE year_month = TO_CHAR(NOW(),'YYYY-MM')"),
      db.query('SELECT COUNT(CASE WHEN opened THEN 1 END)*100.0/NULLIF(COUNT(*),0) as rate FROM emails WHERE created_at > NOW()-INTERVAL\'30d\''),
      db.query('SELECT COUNT(CASE WHEN bounced THEN 1 END)*100.0/NULLIF(COUNT(*),0) as rate FROM emails WHERE created_at > NOW()-INTERVAL\'30d\''),
      db.query('SELECT COUNT(*) as total, COUNT(CASE WHEN status=\'active\' THEN 1 END) as active FROM workspaces'),
    ]);

    const trend = await db.query(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM emails WHERE created_at > NOW()-INTERVAL'30d'
      GROUP BY DATE(created_at) ORDER BY date
    `);

    const topSenders = await db.query(`
      SELECT u.name, u.email, COUNT(e.id) as sent
      FROM users u LEFT JOIN emails e ON e.user_id = u.id
      WHERE u.role='user' GROUP BY u.id, u.name, u.email
      ORDER BY sent DESC LIMIT 5
    `);

    res.json({
      users: {
        total: parseInt(users.rows[0].total),
        active: parseInt(users.rows[0].active),
      },
      workspaces: {
        total: parseInt(workspaces.rows[0].total),
        active: parseInt(workspaces.rows[0].active),
      },
      emails: {
        total: parseInt(emails.rows[0].total),
        today: parseInt(emails.rows[0].today),
        thisMonth: parseInt(monthlyEmails.rows[0].count),
      },
      packages: parseInt(packages.rows[0].total),
      openRate: parseFloat(openRate.rows[0].rate || 0).toFixed(1),
      bounceRate: parseFloat(bounceRate.rows[0].rate || 0).toFixed(1),
      trend: trend.rows,
      topSenders: topSenders.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const { page = 1, limit = 20, search = '', role = '' } = req.query;
  const offset = (page - 1) * limit;
  try {
    const searchParam = `%${search}%`;
    const roleFilter = role ? `AND u.role = '${role === 'admin' ? 'admin' : 'user'}'` : '';
    const { rows } = await db.query(`
      SELECT u.id, u.email, u.name, u.role, u.status, u.created_at,
             COALESCE(mu.email_count, 0) as emails_this_month,
             (SELECT COUNT(*) FROM workspaces w WHERE w.user_id = u.id) as workspace_count,
             (SELECT w.smtp_username FROM workspaces w WHERE w.user_id = u.id ORDER BY w.created_at LIMIT 1) as smtp_username,
             (SELECT p.name FROM workspaces w LEFT JOIN packages p ON p.id = w.package_id WHERE w.user_id = u.id ORDER BY w.created_at LIMIT 1) as package_name,
             (SELECT p.monthly_limit FROM workspaces w LEFT JOIN packages p ON p.id = w.package_id WHERE w.user_id = u.id ORDER BY w.created_at LIMIT 1) as monthly_limit
      FROM users u
      LEFT JOIN monthly_usage mu ON mu.user_id = u.id AND mu.year_month = TO_CHAR(NOW(),'YYYY-MM')
      WHERE (u.email ILIKE $1 OR u.name ILIKE $1) ${roleFilter}
      ORDER BY u.role ASC, u.created_at DESC LIMIT $2 OFFSET $3
    `, [searchParam, limit, offset]);

    const count = await db.query(
      `SELECT COUNT(*) FROM users WHERE (email ILIKE $1 OR name ILIKE $1) ${roleFilter}`,
      [searchParam]
    );

    res.json({ users: rows, total: parseInt(count.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users
router.post('/users',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').trim().notEmpty(),
  body('role').optional().isIn(['user', 'admin']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, name, role = 'user', package_id } = req.body;
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      // smtp_username on users table is still required by schema during transition
      const smtpUsernameForUser = 'smtp_' + crypto.randomBytes(6).toString('hex');
      const smtpPasswordForUser = crypto.randomBytes(16).toString('base64url');
      const smtpPasswordHashForUser = await bcrypt.hash(smtpPasswordForUser, 10);

      const { rows } = await db.query(
        `INSERT INTO users (email, name, password_hash, smtp_username, smtp_password, role, package_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, email, name, role, status, created_at`,
        [email, name, passwordHash, smtpUsernameForUser, smtpPasswordHashForUser, role, package_id || null]
      );
      const user = rows[0];

      // Create workspace for user-role accounts
      let wsSmtpPassword = null;
      let wsSmtpUsername = null;
      if (role === 'user') {
        wsSmtpUsername = 'smtp_' + crypto.randomBytes(6).toString('hex');
        wsSmtpPassword = crypto.randomBytes(16).toString('base64url');
        const wsSmtpPasswordHash = await bcrypt.hash(wsSmtpPassword, 10);
        await db.query(
          `INSERT INTO workspaces (user_id, name, smtp_username, smtp_password, package_id, status)
           VALUES ($1, 'Default', $2, $3, $4, 'active')`,
          [user.id, wsSmtpUsername, wsSmtpPasswordHash, package_id || null]
        );
      }

      await auditLog(req.user, 'user.created', 'user', user.id, { email, role }, req.ip);
      res.status(201).json({
        ...user,
        smtp_username: wsSmtpUsername || smtpUsernameForUser,
        smtp_password: wsSmtpPassword || smtpPasswordForUser,
      });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Email già registrata' });
      res.status(500).json({ error: err.message });
    }
  }
);

// PUT /api/admin/users/:id
router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { name, status, package_id, role } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE users SET
        name = COALESCE($1, name),
        status = COALESCE($2, status),
        role = COALESCE($3, role),
        updated_at = NOW()
      WHERE id = $4 RETURNING id, email, name, role, status`,
      [name, status, role, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Utente non trovato' });
    await auditLog(req.user, 'user.updated', 'user', id, { changes: req.body }, req.ip);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: 'Non puoi eliminare te stesso' });
  try {
    const { rows: target } = await db.query('SELECT email FROM users WHERE id=$1', [id]);
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    await auditLog(req.user, 'user.deleted', 'user', id, { email: target[0]?.email }, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users/:id/workspaces — list workspaces for a user
router.get('/users/:id/workspaces', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT w.*, p.name as package_name, p.monthly_limit
      FROM workspaces w
      LEFT JOIN packages p ON p.id = w.package_id
      WHERE w.user_id = $1
      ORDER BY w.created_at ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset user SMTP password — updates first workspace
router.post('/users/:id/reset-smtp', async (req, res) => {
  const { id } = req.params;
  const newPass = crypto.randomBytes(16).toString('base64url');
  const newPassHash = await bcrypt.hash(newPass, 10);
  try {
    // Update the user's first (or only) workspace
    const { rows } = await db.query(
      `UPDATE workspaces SET smtp_password = $1, updated_at = NOW()
       WHERE user_id = $2 AND id = (SELECT id FROM workspaces WHERE user_id = $2 ORDER BY created_at LIMIT 1)
       RETURNING smtp_username`,
      [newPassHash, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Workspace non trovato' });
    await auditLog(req.user, 'smtp_password.reset', 'user', id, {}, req.ip);
    res.json({ smtp_username: rows[0].smtp_username, smtp_password: newPass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset user web login password
router.post('/users/:id/reset-password',
  body('password').optional().isLength({ min: 8 }),
  async (req, res) => {
    const { id } = req.params;
    const newPassword = req.body.password || crypto.randomBytes(10).toString('base64url');
    try {
      const passwordHash = await bcrypt.hash(newPassword, 12);
      const { rows } = await db.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name',
        [passwordHash, id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Utente non trovato' });
      await auditLog(req.user, 'web_password.reset', 'user', id, {}, req.ip);
      res.json({ ...rows[0], newPassword });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── WORKSPACES (admin) ────────────────────────────────────────

// GET /api/admin/workspaces
router.get('/workspaces', async (req, res) => {
  const { page = 1, limit = 20, user_id, search = '' } = req.query;
  const offset = (page - 1) * limit;
  const conditions = ['1=1'];
  const params = [];

  if (user_id) { params.push(user_id); conditions.push(`w.user_id = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(w.smtp_username ILIKE $${params.length} OR w.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }

  params.push(limit, offset);
  try {
    const { rows } = await db.query(`
      SELECT w.id, w.name, w.smtp_username, w.status, w.whmcs_service_id, w.created_at,
             w.package_id, p.name as package_name, p.monthly_limit,
             u.id as user_id, u.email as user_email, u.name as user_name
      FROM workspaces w
      LEFT JOIN packages p ON p.id = w.package_id
      JOIN users u ON u.id = w.user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY w.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const count = await db.query(
      `SELECT COUNT(*) FROM workspaces w JOIN users u ON u.id = w.user_id WHERE ${conditions.join(' AND ')}`,
      params.slice(0, -2)
    );

    res.json({ workspaces: rows, total: parseInt(count.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/workspaces/:id
router.put('/workspaces/:id', async (req, res) => {
  const { id } = req.params;
  const { name, status, package_id } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE workspaces SET
        name = COALESCE($1, name),
        status = COALESCE($2, status),
        package_id = COALESCE($3, package_id),
        updated_at = NOW()
       WHERE id = $4 RETURNING id, name, status, package_id, smtp_username`,
      [name, status, package_id, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Workspace non trovato' });
    await auditLog(req.user, 'workspace.updated', 'workspace', id, { changes: req.body }, req.ip);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/workspaces/:id/reset-smtp
router.post('/workspaces/:id/reset-smtp', async (req, res) => {
  const { id } = req.params;
  const newPass = crypto.randomBytes(16).toString('base64url');
  const newPassHash = await bcrypt.hash(newPass, 10);
  try {
    const { rows } = await db.query(
      'UPDATE workspaces SET smtp_password = $1, updated_at = NOW() WHERE id = $2 RETURNING smtp_username',
      [newPassHash, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Workspace non trovato' });
    await auditLog(req.user, 'workspace.smtp_reset', 'workspace', id, {}, req.ip);
    res.json({ smtp_username: rows[0].smtp_username, smtp_password: newPass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/workspaces/:id
router.delete('/workspaces/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      'DELETE FROM workspaces WHERE id=$1 RETURNING user_id',
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Workspace non trovato' });
    await auditLog(req.user, 'workspace.deleted', 'workspace', id, {}, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PACKAGES ────────────────────────────────────────────────

// GET /api/admin/packages
router.get('/packages', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.*, COUNT(w.id) as user_count
      FROM packages p LEFT JOIN workspaces w ON w.package_id = p.id
      GROUP BY p.id ORDER BY p.price ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/packages
router.post('/packages',
  body('name').trim().notEmpty(),
  body('monthly_limit').isInt({ min: 1 }),
  body('price').isFloat({ min: 0 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, description, monthly_limit, daily_limit, hourly_limit, price, features } = req.body;
    try {
      const { rows } = await db.query(
        `INSERT INTO packages (name, description, monthly_limit, daily_limit, hourly_limit, price, features)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [name, description, monthly_limit, daily_limit || null, hourly_limit || null, price, JSON.stringify(features || [])]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// PUT /api/admin/packages/:id
router.put('/packages/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, monthly_limit, daily_limit, hourly_limit, price, features, is_active } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE packages SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        monthly_limit = COALESCE($3, monthly_limit),
        daily_limit = COALESCE($4, daily_limit),
        hourly_limit = COALESCE($5, hourly_limit),
        price = COALESCE($6, price),
        features = COALESCE($7, features),
        is_active = COALESCE($8, is_active),
        updated_at = NOW()
      WHERE id = $9 RETURNING *`,
      [name, description, monthly_limit, daily_limit, hourly_limit, price,
       features ? JSON.stringify(features) : null, is_active, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Pacchetto non trovato' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/packages/:id
router.delete('/packages/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const inUse = await db.query('SELECT COUNT(*) FROM workspaces WHERE package_id = $1', [id]);
    if (parseInt(inUse.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Pacchetto in uso da workspace attivi' });
    }
    await db.query('DELETE FROM packages WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/impersonate
router.post('/users/:id/impersonate', async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: 'Non puoi impersonare te stesso' });
  try {
    const { rows } = await db.query(
      'SELECT id, email, name, role, status FROM users WHERE id = $1',
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Utente non trovato' });
    if (rows[0].role === 'admin') return res.status(400).json({ error: 'Non puoi impersonare un admin' });
    if (rows[0].status !== 'active') return res.status(400).json({ error: 'Account sospeso' });

    // Load first workspace for impersonation token
    const { rows: wsRows } = await db.query(
      'SELECT id FROM workspaces WHERE user_id = $1 AND status = $2 ORDER BY created_at LIMIT 1',
      [id, 'active']
    );

    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const tokenPayload = { id: rows[0].id, role: rows[0].role, impersonatedBy: req.user.id };
    if (wsRows[0]) tokenPayload.workspace_id = wsRows[0].id;

    const token = jwt.sign(tokenPayload, config.jwt.secret, { expiresIn: '4h' });
    await auditLog(req.user, 'user.impersonated', 'user', id, { target_email: rows[0].email }, req.ip);
    res.json({ token, user: rows[0], impersonatedBy: { id: req.user.id, email: req.user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SETTINGS ─────────────────────────────────────────────────

// GET /api/admin/settings
router.get('/settings', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT key, value FROM app_settings');
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.key === 'provision_api_key' && row.value
        ? row.value.substring(0, 4) + '****'
        : row.value;
    }
    const envKey = process.env.PROVISION_API_KEY || '';
    const dbKey = rows.find(r => r.key === 'provision_api_key')?.value || '';
    settings.provision_api_key_set = !!(dbKey || envKey);
    settings.provision_api_key_source = dbKey ? 'database' : (envKey ? 'env' : 'none');
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/settings
router.put('/settings', async (req, res) => {
  const { provision_api_key, spf_record, dkim_selector } = req.body;
  try {
    if (provision_api_key !== undefined) {
      if (!provision_api_key || provision_api_key.length < 16) {
        return res.status(400).json({ error: 'provision_api_key deve essere almeno 16 caratteri' });
      }
      await db.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('provision_api_key', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
        [provision_api_key]
      );
    }
    if (spf_record !== undefined) {
      await db.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('spf_record', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
        [spf_record]
      );
    }
    if (dkim_selector !== undefined) {
      const selector = (dkim_selector || 'smtpflow').trim().replace(/[^a-z0-9_-]/gi, '').toLowerCase();
      await db.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('dkim_selector', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
        [selector]
      );
    }
    for (const key of ['bounce_notification_subject', 'bounce_notification_body',
      'smtp_system_host', 'smtp_system_port', 'smtp_system_user', 'smtp_system_pass', 'smtp_system_from']) {
      if (req.body[key] !== undefined) {
        await db.query(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
          [key, req.body[key]]
        );
      }
    }
    await auditLog(req.user, 'settings.updated', 'settings', null, { keys: Object.keys(req.body) }, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/settings/generate-key
router.post('/settings/generate-key', async (req, res) => {
  const crypto = require('crypto');
  const newKey = 'sf_' + crypto.randomBytes(24).toString('base64url');
  res.json({ key: newKey });
});

// GET /api/admin/audit
router.get('/audit', async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const [{ rows }, count] = await Promise.all([
      db.query(
        'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      ),
      db.query('SELECT COUNT(*) FROM audit_logs'),
    ]);
    res.json({ logs: rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/emails
router.get('/emails', async (req, res) => {
  const { page = 1, limit = 50, user_id, status } = req.query;
  const offset = (page - 1) * limit;
  const conditions = ['1=1'];
  const params = [];
  if (user_id) { params.push(user_id); conditions.push(`e.user_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`e.status = $${params.length}`); }
  params.push(limit, offset);

  try {
    const { rows } = await db.query(`
      SELECT e.*, u.name as user_name, u.email as user_email
      FROM emails e JOIN users u ON u.id = e.user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SUPPRESSION LIST ──────────────────────────────────────────

router.get('/suppression', async (req, res) => {
  const { page = 1, limit = 50, search = '' } = req.query;
  const offset = (page - 1) * limit;
  try {
    const s = `%${search}%`;
    const [{ rows }, count] = await Promise.all([
      db.query(
        'SELECT * FROM suppression_list WHERE email ILIKE $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [s, limit, offset]
      ),
      db.query('SELECT COUNT(*) FROM suppression_list WHERE email ILIKE $1', [s]),
    ]);
    res.json({ items: rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/suppression', async (req, res) => {
  const { email, reason = 'manual' } = req.body;
  if (!email) return res.status(400).json({ error: 'Email richiesta' });
  try {
    await db.query(
      `INSERT INTO suppression_list (email, reason) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
      [email.toLowerCase().trim(), reason]
    );
    await auditLog(req.user, 'suppression.added', 'suppression', null, { email }, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/suppression/:email', async (req, res) => {
  const email = decodeURIComponent(req.params.email);
  try {
    await db.query('DELETE FROM suppression_list WHERE email=$1', [email.toLowerCase()]);
    await auditLog(req.user, 'suppression.removed', 'suppression', null, { email }, req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SYSTEM STATS ──────────────────────────────────────────────

router.get('/system', async (req, res) => {
  const os = require('os');
  const { execSync } = require('child_process');

  try {
    const load = os.loadavg()[0];
    const cpus = os.cpus().length;
    const cpuPercent = Math.min(Math.round((load / cpus) * 100), 100);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    let diskTotal = 0, diskUsed = 0, diskFree = 0;
    try {
      const dfOut = execSync("df -k / | tail -1", { timeout: 3000 }).toString().trim();
      const parts = dfOut.split(/\s+/);
      diskTotal = parseInt(parts[1]) * 1024;
      diskUsed  = parseInt(parts[2]) * 1024;
      diskFree  = parseInt(parts[3]) * 1024;
    } catch {}

    const uptimeSec = os.uptime();

    res.json({
      cpu: { percent: cpuPercent, load1: load.toFixed(2), cores: cpus },
      ram: { total: totalMem, used: usedMem, free: freeMem, percent: Math.round((usedMem / totalMem) * 100) },
      disk: { total: diskTotal, used: diskUsed, free: diskFree, percent: diskTotal ? Math.round((diskUsed / diskTotal) * 100) : 0 },
      uptime: uptimeSec,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
