const nodemailer = require('nodemailer');
const logger = require('../logger');

/**
 * Crea un nodemailer transporter configurabile via env vars.
 *
 * Provider supportati (RELAY_PROVIDER è solo un'etichetta documentale):
 *   postfix / mailhog  → RELAY_HOST + RELAY_PORT, senza auth
 *   mailgun            → RELAY_HOST=smtp.mailgun.org, RELAY_USER, RELAY_PASS
 *   sendgrid           → RELAY_HOST=smtp.sendgrid.net, RELAY_USER=apikey, RELAY_PASS=SG.xxx
 *   ses                → RELAY_HOST=email-smtp.<region>.amazonaws.com, RELAY_USER, RELAY_PASS
 *   smtp               → qualsiasi server SMTP con credenziali
 *
 * Tutti i provider usano lo stesso meccanismo SMTP — solo host/user/pass cambiano.
 */
function createRelayTransporter() {
  const provider = process.env.RELAY_PROVIDER || 'postfix';
  const host     = process.env.RELAY_HOST || process.env.POSTFIX_HOST || '127.0.0.1';
  const port     = parseInt(process.env.RELAY_PORT || process.env.POSTFIX_PORT || '25');
  const secure   = process.env.RELAY_SECURE === 'true';
  const user     = process.env.RELAY_USER || '';
  const pass     = process.env.RELAY_PASS || '';

  const transportConfig = {
    host,
    port,
    secure,
    auth: (user && pass) ? { user, pass } : undefined,
    tls: {
      rejectUnauthorized: process.env.RELAY_TLS_REJECT_UNAUTHORIZED !== 'false',
    },
  };

  logger.info(`Relay transporter: provider=${provider} host=${host}:${port} auth=${!!user}`);
  return nodemailer.createTransport(transportConfig);
}

// Singleton — creato una volta all'avvio
const transporter = createRelayTransporter();
module.exports = transporter;
