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

module.exports = router;
