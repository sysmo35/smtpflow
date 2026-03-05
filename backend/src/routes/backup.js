'use strict';

const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const backup = require('../services/backupService');
const logger = require('../logger');
const fs = require('fs');

const router = express.Router();
router.use(authenticate, requireAdmin);

// GET /api/admin/backup/config
router.get('/config', async (req, res) => {
  try {
    const cfg = await backup.getSftpConfig();
    // Mask password for the response
    res.json({ ...cfg, password: cfg.password ? '••••••••' : '' });
  } catch (e) {
    logger.error('backup/config GET error', { err: e.message });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/backup/config
router.put('/config', async (req, res) => {
  try {
    const { host, port, username, password, remote_path } = req.body;
    if (!host || !username) {
      return res.status(400).json({ error: 'host e username sono obbligatori' });
    }

    // If password is masked (unchanged), keep existing
    let finalPassword = password;
    if (password === '••••••••' || password === '') {
      const existing = await backup.getSftpConfig();
      finalPassword = existing.password;
    }

    await backup.saveSftpConfig({ host, port: port || 22, username, password: finalPassword, remote_path: remote_path || '/backups' });
    res.json({ ok: true });
  } catch (e) {
    logger.error('backup/config PUT error', { err: e.message });
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/backup/test
router.post('/test', async (req, res) => {
  try {
    const cfg = await backup.getSftpConfig();
    if (!cfg.host || !cfg.username) {
      return res.status(400).json({ error: 'Configurazione SFTP non completata' });
    }
    await backup.testSftpConnection(cfg);
    res.json({ ok: true, message: 'Connessione SFTP riuscita' });
  } catch (e) {
    logger.warn('backup/test failed', { err: e.message });
    res.status(400).json({ error: `Connessione fallita: ${e.message}` });
  }
});

// POST /api/admin/backup/create
router.post('/create', async (req, res) => {
  try {
    const cfg = await backup.getSftpConfig();
    if (!cfg.host || !cfg.username) {
      return res.status(400).json({ error: 'Configura prima le impostazioni SFTP' });
    }

    logger.info('Backup: starting backup process', { admin: req.user.email });

    const { archivePath, filename, size } = await backup.createBackup();
    try {
      await backup.uploadToSftp(archivePath, cfg);
    } finally {
      if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    }

    res.json({ ok: true, filename, size });
  } catch (e) {
    logger.error('backup/create error', { err: e.message });
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/backup/list
router.get('/list', async (req, res) => {
  try {
    const cfg = await backup.getSftpConfig();
    if (!cfg.host || !cfg.username) {
      return res.json({ backups: [] });
    }
    const backups = await backup.listSftpBackups(cfg);
    res.json({ backups });
  } catch (e) {
    logger.error('backup/list error', { err: e.message });
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/backup/restore
router.post('/restore', async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename || !filename.startsWith('smtpflow-backup-') || !filename.endsWith('.tar.gz')) {
      return res.status(400).json({ error: 'Nome file non valido' });
    }

    const cfg = await backup.getSftpConfig();
    if (!cfg.host || !cfg.username) {
      return res.status(400).json({ error: 'Configurazione SFTP mancante' });
    }

    logger.info('Restore: starting restore', { admin: req.user.email, filename });

    const localPath = await backup.downloadFromSftp(filename, cfg);
    const results = await backup.restoreBackup(localPath);

    res.json({ ok: true, results });
  } catch (e) {
    logger.error('backup/restore error', { err: e.message });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/backup/:filename
router.delete('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    if (!filename.startsWith('smtpflow-backup-') || !filename.endsWith('.tar.gz')) {
      return res.status(400).json({ error: 'Nome file non valido' });
    }
    const cfg = await backup.getSftpConfig();
    await backup.deleteFromSftp(filename, cfg);
    res.json({ ok: true });
  } catch (e) {
    logger.error('backup/delete error', { err: e.message });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
