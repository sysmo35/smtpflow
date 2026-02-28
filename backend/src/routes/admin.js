const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireAdmin);

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [users, emails, packages, monthlyEmails, openRate, bounceRate] = await Promise.all([
      db.query('SELECT COUNT(*) as total, COUNT(CASE WHEN status=\'active\' THEN 1 END) as active FROM users WHERE role=\'user\''),
      db.query('SELECT COUNT(*) as total, COUNT(CASE WHEN created_at > NOW()-INTERVAL\'24h\' THEN 1 END) as today FROM emails'),
      db.query('SELECT COUNT(*) as total FROM packages WHERE is_active=true'),
      db.query("SELECT COALESCE(SUM(email_count),0) as count FROM monthly_usage WHERE year_month = TO_CHAR(NOW(),'YYYY-MM')"),
      db.query('SELECT COUNT(CASE WHEN opened THEN 1 END)*100.0/NULLIF(COUNT(*),0) as rate FROM emails WHERE created_at > NOW()-INTERVAL\'30d\''),
      db.query('SELECT COUNT(CASE WHEN bounced THEN 1 END)*100.0/NULLIF(COUNT(*),0) as rate FROM emails WHERE created_at > NOW()-INTERVAL\'30d\''),
    ]);

    // Daily email trend (last 30 days)
    const trend = await db.query(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM emails WHERE created_at > NOW()-INTERVAL'30d'
      GROUP BY DATE(created_at) ORDER BY date
    `);

    // Top senders
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
      SELECT u.id, u.email, u.name, u.role, u.status, u.smtp_username, u.created_at,
             p.name as package_name, p.monthly_limit,
             COALESCE(mu.email_count, 0) as emails_this_month
      FROM users u
      LEFT JOIN packages p ON p.id = u.package_id
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
      const smtpUsername = 'smtp_' + crypto.randomBytes(6).toString('hex');
      const smtpPassword = crypto.randomBytes(16).toString('base64url');

      const { rows } = await db.query(
        `INSERT INTO users (email, name, password_hash, smtp_username, smtp_password, role, package_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, email, name, role, status, smtp_username, created_at`,
        [email, name, passwordHash, smtpUsername, smtpPassword, role, package_id || null]
      );
      res.status(201).json(rows[0]);
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
        package_id = COALESCE($3, package_id),
        role = COALESCE($4, role),
        updated_at = NOW()
      WHERE id = $5 RETURNING id, email, name, role, status`,
      [name, status, package_id, role, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Utente non trovato' });
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
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset user SMTP password
router.post('/users/:id/reset-smtp', async (req, res) => {
  const { id } = req.params;
  const newPass = crypto.randomBytes(16).toString('base64url');
  try {
    const { rows } = await db.query(
      'UPDATE users SET smtp_password = $1, updated_at = NOW() WHERE id = $2 RETURNING smtp_username, smtp_password',
      [newPass, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Utente non trovato' });
    res.json(rows[0]);
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
      res.json({ ...rows[0], newPassword });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── PACKAGES ────────────────────────────────────────────────

// GET /api/admin/packages
router.get('/packages', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.*, COUNT(u.id) as user_count
      FROM packages p LEFT JOIN users u ON u.package_id = p.id
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
    const inUse = await db.query('SELECT COUNT(*) FROM users WHERE package_id = $1', [id]);
    if (parseInt(inUse.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Pacchetto in uso da utenti attivi' });
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

    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const token = jwt.sign(
      { id: rows[0].id, role: rows[0].role, impersonatedBy: req.user.id },
      config.jwt.secret,
      { expiresIn: '4h' }
    );
    res.json({ token, user: rows[0], impersonatedBy: { id: req.user.id, email: req.user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/emails - all emails log
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

module.exports = router;
