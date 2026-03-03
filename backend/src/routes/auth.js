const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../database');
const config = require('../config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function generateSmtpCredentials() {
  const username = 'smtp_' + crypto.randomBytes(6).toString('hex');
  const password = crypto.randomBytes(16).toString('base64url');
  return { username, password };
}

// POST /api/auth/login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
      const { rows } = await db.query(
        'SELECT id, email, name, password_hash, role, status, package_id FROM users WHERE email = $1',
        [email]
      );
      const user = rows[0];
      if (!user) return res.status(401).json({ error: 'Credenziali non valide' });
      if (user.status !== 'active') return res.status(403).json({ error: 'Account sospeso' });

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Credenziali non valide' });

      const token = jwt.sign({ id: user.id, role: user.role }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
    } catch (err) {
      res.status(500).json({ error: 'Errore server' });
    }
  }
);

// POST /api/auth/register
router.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').trim().isLength({ min: 2 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, name } = req.body;
    try {
      // Check if email exists
      const exists = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (exists.rows[0]) return res.status(409).json({ error: 'Email già registrata' });

      // Get free package
      const pkgResult = await db.query("SELECT id FROM packages WHERE name = 'Free' AND is_active = true LIMIT 1");
      const packageId = pkgResult.rows[0]?.id || null;

      const passwordHash = await bcrypt.hash(password, 12);
      const { username, password: smtpPass } = generateSmtpCredentials();

      const { rows } = await db.query(
        `INSERT INTO users (email, name, password_hash, smtp_username, smtp_password, package_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, name, role`,
        [email, name, passwordHash, username, smtpPass, packageId]
      );

      const user = rows[0];
      const token = jwt.sign({ id: user.id, role: user.role }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
      res.status(201).json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
    } catch (err) {
      res.status(500).json({ error: 'Errore server' });
    }
  }
);

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/sso?token=... — valida token SSO emesso da /api/provision/sso
// Restituisce un JWT di sessione normale per auto-login del frontend.
router.get('/sso', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token is required' });

  try {
    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret);
    } catch (e) {
      return res.status(401).json({ error: 'Token SSO non valido o scaduto' });
    }

    if (payload.type !== 'sso') {
      return res.status(401).json({ error: 'Token non è di tipo SSO' });
    }

    const { rows } = await db.query(
      'SELECT id, email, name, role, status FROM users WHERE id=$1',
      [payload.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Account sospeso' });

    const sessionToken = jwt.sign(
      { id: user.id, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({
      token: sessionToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: 'Errore server' });
  }
});

// Helper: crea transporter nodemailer con SMTP di sistema configurato dall'admin
async function getSystemMailer() {
  const { rows } = await db.query(
    "SELECT key, value FROM app_settings WHERE key LIKE 'smtp_system_%'"
  );
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (!s.smtp_system_host) return null;
  const nodemailer = require('nodemailer');
  return {
    mailer: nodemailer.createTransport({
      host: s.smtp_system_host,
      port: parseInt(s.smtp_system_port || '587'),
      secure: parseInt(s.smtp_system_port || '587') === 465,
      auth: s.smtp_system_user ? { user: s.smtp_system_user, pass: s.smtp_system_pass } : undefined,
    }),
    from: s.smtp_system_from || `noreply@${config.smtp.hostname}`,
  };
}

// POST /api/auth/forgot-password
router.post('/forgot-password',
  body('email').isEmail().normalizeEmail(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    // Rispondi sempre con successo (anti-enumeration)
    res.json({ success: true });

    setImmediate(async () => {
      try {
        const { email } = req.body;
        const { rows } = await db.query(
          "SELECT id, name FROM users WHERE email=$1 AND status='active'",
          [email]
        );
        if (!rows[0]) return;

        const system = await getSystemMailer();
        if (!system) return;

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 ora

        await db.query(
          'UPDATE password_reset_tokens SET used=true WHERE user_id=$1 AND used=false',
          [rows[0].id]
        );
        await db.query(
          'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
          [rows[0].id, token, expiresAt]
        );

        const resetUrl = `${config.app.baseUrl}/reset-password?token=${token}`;
        await system.mailer.sendMail({
          from: system.from,
          to: email,
          subject: 'Reset password',
          text: `Ciao ${rows[0].name},\n\nHai richiesto il reset della password.\n\nClicca qui:\n${resetUrl}\n\nIl link scade tra 1 ora.\n\nSe non hai richiesto il reset, ignora questa email.`,
        });
      } catch (e) {}
    });
  }
);

// POST /api/auth/reset-password
router.post('/reset-password',
  body('token').notEmpty(),
  body('password').isLength({ min: 8 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { token, password } = req.body;
    try {
      const { rows } = await db.query(
        `SELECT prt.id, prt.user_id FROM password_reset_tokens prt
         WHERE prt.token=$1 AND prt.used=false AND prt.expires_at > NOW()`,
        [token]
      );
      if (!rows[0]) return res.status(400).json({ error: 'Token non valido o scaduto' });

      const passwordHash = await bcrypt.hash(password, 12);
      await Promise.all([
        db.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [passwordHash, rows[0].user_id]),
        db.query('UPDATE password_reset_tokens SET used=true WHERE id=$1', [rows[0].id]),
      ]);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
