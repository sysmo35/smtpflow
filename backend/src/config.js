require('dotenv').config();

module.exports = {
  app: {
    port: parseInt(process.env.PORT || '3000'),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'smtpflow',
    user: process.env.DB_USER || 'smtpflow',
    password: process.env.DB_PASS || '',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change-this-secret-in-production',
    expiresIn: '7d',
  },
  smtp: {
    port: parseInt(process.env.SMTP_PORT || '587'),
    portSSL: parseInt(process.env.SMTP_PORT_SSL || '465'),
    hostname: process.env.SMTP_HOSTNAME || 'localhost',
  },
  relay: {
    // Provider: postfix | mailhog | mailgun | sendgrid | ses | smtp
    // Tutti usano SMTP — cambia solo host/user/pass.
    // Mailgun:  RELAY_HOST=smtp.mailgun.org  RELAY_USER=postmaster@dom  RELAY_PASS=key-xxx
    // SendGrid: RELAY_HOST=smtp.sendgrid.net RELAY_USER=apikey          RELAY_PASS=SG.xxx
    // SES:      RELAY_HOST=email-smtp.<region>.amazonaws.com            RELAY_USER+PASS da console AWS
    provider: process.env.RELAY_PROVIDER || 'postfix',
    host: process.env.RELAY_HOST || process.env.POSTFIX_HOST || '127.0.0.1',
    port: parseInt(process.env.RELAY_PORT || process.env.POSTFIX_PORT || '25'),
    secure: process.env.RELAY_SECURE === 'true',
    user: process.env.RELAY_USER || '',
    pass: process.env.RELAY_PASS || '',
  },
  tracking: {
    pixelPath: '/t/open',
    clickPath: '/t/click',
    bounceAddress: process.env.BOUNCE_ADDRESS || 'bounce',
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@localhost',
    password: process.env.ADMIN_PASS || 'changeme',
  },
};
