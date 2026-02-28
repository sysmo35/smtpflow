/**
 * dkimManager — gestisce le chiavi DKIM per ogni dominio cliente.
 *
 * Funzionamento:
 *  - Docker: scrive la chiave in DKIM_KEYS_DIR (volume condiviso con il container Postfix).
 *    Il container Postfix ha un watcher che rileva nuove chiavi e ricarica OpenDKIM.
 *  - VPS:    scrive la chiave in DKIM_KEYS_DIR e chiama sync-dkim.sh via sudo,
 *            che aggiorna /etc/opendkim/ e ricarica OpenDKIM.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../logger');

const DKIM_KEYS_DIR = process.env.DKIM_KEYS_DIR || '/dkim-keys';
const DKIM_MODE     = process.env.DKIM_MODE     || 'docker'; // 'docker' | 'vps'
const SYNC_SCRIPT   = process.env.DKIM_SYNC_SCRIPT || '/opt/smtpflow/sync-dkim.sh';

/**
 * Registra la chiave DKIM privata di un dominio.
 * Chiamare dopo che il dominio è verificato via SPF.
 */
async function registerDomainDkim(domain, privateKeyPem) {
  try {
    const domainDir = path.join(DKIM_KEYS_DIR, domain);
    fs.mkdirSync(domainDir, { recursive: true });

    const keyPath = path.join(domainDir, 'smtpflow.private');
    fs.writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });

    if (DKIM_MODE === 'vps') {
      try {
        execSync(`sudo ${SYNC_SCRIPT}`, { stdio: 'ignore', timeout: 10000 });
      } catch (e) {
        logger.warn(`DKIM sync script failed (non-fatal): ${e.message}`);
      }
    }
    // Docker: il watcher nel container Postfix rileva la nuova chiave automaticamente

    logger.info(`DKIM key registered for domain: ${domain}`);
    return true;
  } catch (err) {
    logger.error(`DKIM registration failed for ${domain}: ${err.message}`);
    return false;
  }
}

/**
 * Rimuove la chiave DKIM di un dominio (quando l'utente elimina il dominio).
 */
async function removeDomainDkim(domain) {
  try {
    const domainDir = path.join(DKIM_KEYS_DIR, domain);
    if (fs.existsSync(domainDir)) {
      fs.rmSync(domainDir, { recursive: true, force: true });
    }

    if (DKIM_MODE === 'vps') {
      try {
        execSync(`sudo ${SYNC_SCRIPT}`, { stdio: 'ignore', timeout: 10000 });
      } catch (e) {
        logger.warn(`DKIM sync script failed on remove (non-fatal): ${e.message}`);
      }
    }

    logger.info(`DKIM key removed for domain: ${domain}`);
  } catch (err) {
    logger.error(`DKIM removal failed for ${domain}: ${err.message}`);
  }
}

module.exports = { registerDomainDkim, removeDomainDkim };
