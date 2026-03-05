require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const config = require('./config');
const logger = require('./logger');
const db = require('./database');
const { startSMTPServers } = require('./services/smtpServer');

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');
const workspacesRoutes = require('./routes/workspaces');
const sendRoutes = require('./routes/send');
const trackingRoutes = require('./routes/tracking');
const brandingRoutes = require('./routes/branding');
const provisionRoutes = require('./routes/provision');
const backupRoutes = require('./routes/backup');

const app = express();

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', 1);

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global rate limit
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Auth routes have stricter limit
app.use('/api/auth/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user/workspaces', workspacesRoutes);
app.use('/api/user', userRoutes);
app.use('/api/send', sendRoutes);
app.use('/api/provision', provisionRoutes);
app.use('/api/admin/backup', backupRoutes);
app.use('/api', brandingRoutes);   // GET /api/branding (pub) + GET|PUT /api/admin/branding
app.use('/t', trackingRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// Serve frontend in production
if (config.app.env === 'production') {
  const frontendPath = process.env.FRONTEND_PATH || path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { err: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    // Test DB connection
    const dbOk = await db.testConnection();
    if (!dbOk) throw new Error('Database connection failed');

    // Run migrations
    await db.migrate();

    // Hash any SMTP passwords still stored in plaintext (idempotent)
    const bcrypt = require('bcryptjs');
    const crypto = require('crypto');
    const { rows: usersToHash } = await db.query(
      "SELECT id, smtp_password FROM users WHERE smtp_password NOT LIKE '$2%'"
    );
    for (const u of usersToHash) {
      const h = await bcrypt.hash(u.smtp_password, 10);
      await db.query('UPDATE users SET smtp_password=$1 WHERE id=$2', [h, u.id]);
    }
    if (usersToHash.length > 0) logger.info(`Hashed ${usersToHash.length} plaintext SMTP password(s)`);

    // Create default admin if not exists
    const adminExists = await db.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
    if (!adminExists.rows[0]) {
      const hash = await bcrypt.hash(config.admin.password, 12);
      const smtpUsername = 'smtp_admin_' + crypto.randomBytes(4).toString('hex');
      const smtpPassword = crypto.randomBytes(16).toString('base64url');
      const smtpPasswordHash = await bcrypt.hash(smtpPassword, 10);
      await db.query(
        `INSERT INTO users (email, name, password_hash, smtp_username, smtp_password, role)
         VALUES ($1, 'Administrator', $2, $3, $4, 'admin')`,
        [config.admin.email, hash, smtpUsername, smtpPasswordHash]
      );
      logger.info(`Admin created: ${config.admin.email}`);
    }

    // Start web server
    app.listen(config.app.port, config.app.host, () => {
      logger.info(`Web server listening on ${config.app.host}:${config.app.port}`);
    });

    // Start SMTP servers
    startSMTPServers();

    logger.info('SMTPFlow started successfully');
  } catch (err) {
    logger.error('Startup failed', err);
    process.exit(1);
  }
}

start();

module.exports = app;
