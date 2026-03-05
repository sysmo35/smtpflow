'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const archiver = require('archiver');
const SftpClient = require('ssh2-sftp-client');
const db = require('../database');
const logger = require('../logger');

// --- Helpers ---

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function escapeVal(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

// --- Database dump (pure JS, no pg_dump required) ---

async function dumpDatabase() {
  const tables = [
    'packages', 'users', 'workspaces', 'domains',
    'emails', 'email_events', 'monthly_usage', 'api_keys',
    'suppression_list', 'password_reset_tokens',
    'branding_settings', 'app_settings', 'audit_logs',
  ];

  let sql = `-- SMTPFlow Database Backup\n`;
  sql += `-- Created: ${new Date().toISOString()}\n`;
  sql += `-- Format: v1\n\n`;
  sql += `BEGIN;\n`;
  sql += `SET session_replication_role = replica;\n\n`;

  for (const table of tables) {
    try {
      const { rows } = await db.query(
        `SELECT * FROM ${table} ORDER BY created_at ASC NULLS FIRST`
      );
      if (rows.length === 0) continue;

      const cols = Object.keys(rows[0]);
      sql += `-- Table: ${table} (${rows.length} rows)\n`;
      sql += `DELETE FROM "${table}";\n`;

      for (const row of rows) {
        const quotedCols = cols.map(c => `"${c}"`).join(', ');
        const values = cols.map(c => escapeVal(row[c])).join(', ');
        sql += `INSERT INTO "${table}" (${quotedCols}) VALUES (${values});\n`;
      }
      sql += '\n';
    } catch (e) {
      logger.warn(`Backup: skipping table "${table}": ${e.message}`);
    }
  }

  sql += `SET session_replication_role = DEFAULT;\n`;
  sql += `COMMIT;\n`;
  return sql;
}

// --- Create archive ---

async function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupName = `smtpflow-backup-${timestamp}`;
  const tmpDir = path.join(os.tmpdir(), backupName);
  const archivePath = path.join(os.tmpdir(), `${backupName}.tar.gz`);

  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 1. Database dump
    logger.info('Backup: dumping database...');
    const sql = await dumpDatabase();
    fs.writeFileSync(path.join(tmpDir, 'database.sql'), sql, 'utf8');

    // 2. DKIM keys
    const dkimDir = process.env.DKIM_KEYS_DIR || '/dkim-keys';
    if (fs.existsSync(dkimDir)) {
      logger.info('Backup: copying DKIM keys...');
      copyDirSync(dkimDir, path.join(tmpDir, 'dkim-keys'));
    }

    // 3. .env file (try common locations)
    const envCandidates = [
      path.join(__dirname, '../../../.env.production'),
      path.join(__dirname, '../../.env'),
      path.join(__dirname, '../../../.env'),
      '/opt/smtpflow/backend/.env',
    ];
    for (const p of envCandidates) {
      if (fs.existsSync(p)) {
        fs.copyFileSync(p, path.join(tmpDir, 'env.backup'));
        logger.info(`Backup: saved env from ${p}`);
        break;
      }
    }

    // 4. Manifest
    const manifest = {
      version: '1.0',
      created_at: new Date().toISOString(),
      node_version: process.version,
      hostname: os.hostname(),
      contents: ['database.sql', 'dkim-keys/', 'env.backup', 'manifest.json'],
    };
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 5. Create tar.gz archive
    logger.info('Backup: creating archive...');
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(archivePath);
      const arc = archiver('tar', { gzip: true, gzipOptions: { level: 6 } });
      output.on('close', resolve);
      arc.on('error', reject);
      arc.pipe(output);
      arc.directory(tmpDir, false);
      arc.finalize();
    });

    const { size } = fs.statSync(archivePath);
    logger.info(`Backup: archive created (${(size / 1024 / 1024).toFixed(2)} MB)`);

    return { archivePath, filename: `${backupName}.tar.gz`, size };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// --- SFTP helpers ---

async function connectSftp(sftpConfig) {
  const sftp = new SftpClient();
  await sftp.connect({
    host: sftpConfig.host,
    port: parseInt(sftpConfig.port) || 22,
    username: sftpConfig.username,
    password: sftpConfig.password,
    readyTimeout: 15000,
    retries: 1,
  });
  return sftp;
}

async function testSftpConnection(sftpConfig) {
  const sftp = await connectSftp(sftpConfig);
  try {
    const remotePath = sftpConfig.remote_path || '/backups';
    await sftp.mkdir(remotePath, true);
    return { ok: true };
  } finally {
    sftp.end();
  }
}

async function uploadToSftp(localPath, sftpConfig) {
  const sftp = await connectSftp(sftpConfig);
  try {
    const remotePath = sftpConfig.remote_path || '/backups';
    await sftp.mkdir(remotePath, true);
    const remoteFile = `${remotePath}/${path.basename(localPath)}`;
    await sftp.put(localPath, remoteFile);
    logger.info(`Backup: uploaded to SFTP ${remoteFile}`);
    return remoteFile;
  } finally {
    sftp.end();
  }
}

async function listSftpBackups(sftpConfig) {
  const sftp = await connectSftp(sftpConfig);
  try {
    const remotePath = sftpConfig.remote_path || '/backups';
    await sftp.mkdir(remotePath, true);
    const list = await sftp.list(remotePath);
    return list
      .filter(f => f.name.startsWith('smtpflow-backup-') && f.name.endsWith('.tar.gz'))
      .sort((a, b) => b.modifyTime - a.modifyTime)
      .map(f => ({
        name: f.name,
        size: f.size,
        modified: new Date(f.modifyTime).toISOString(),
      }));
  } finally {
    sftp.end();
  }
}

async function downloadFromSftp(filename, sftpConfig) {
  const sftp = await connectSftp(sftpConfig);
  const localPath = path.join(os.tmpdir(), filename);
  try {
    const remotePath = `${sftpConfig.remote_path || '/backups'}/${filename}`;
    await sftp.get(remotePath, localPath);
    logger.info(`Backup: downloaded ${filename} from SFTP`);
    return localPath;
  } finally {
    sftp.end();
  }
}

async function deleteFromSftp(filename, sftpConfig) {
  const sftp = await connectSftp(sftpConfig);
  try {
    const remotePath = `${sftpConfig.remote_path || '/backups'}/${filename}`;
    await sftp.delete(remotePath);
    logger.info(`Backup: deleted ${filename} from SFTP`);
  } finally {
    sftp.end();
  }
}

// --- Restore ---

async function restoreBackup(archivePath) {
  const extractDir = path.join(os.tmpdir(), `smtpflow-restore-${Date.now()}`);
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    // Extract archive
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { timeout: 60000 });
    logger.info('Restore: archive extracted');

    const results = { db: false, dkim: false, env_available: false };

    // 1. Restore database
    const sqlFile = path.join(extractDir, 'database.sql');
    if (fs.existsSync(sqlFile)) {
      const sql = fs.readFileSync(sqlFile, 'utf8');
      const client = await db.pool.connect();
      try {
        await client.query(sql);
        results.db = true;
        logger.info('Restore: database restored successfully');
      } finally {
        client.release();
      }
    }

    // 2. Restore DKIM keys
    const dkimBackupDir = path.join(extractDir, 'dkim-keys');
    const dkimDir = process.env.DKIM_KEYS_DIR || '/dkim-keys';
    if (fs.existsSync(dkimBackupDir) && fs.existsSync(dkimDir)) {
      copyDirSync(dkimBackupDir, dkimDir);
      results.dkim = true;
      logger.info('Restore: DKIM keys restored');
    }

    // 3. Check if .env backup is available (manual step required)
    if (fs.existsSync(path.join(extractDir, 'env.backup'))) {
      results.env_available = true;
    }

    return results;
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }
  }
}

// --- SFTP config storage (in app_settings) ---

async function getSftpConfig() {
  const keys = ['sftp_host', 'sftp_port', 'sftp_username', 'sftp_password', 'sftp_remote_path'];
  const { rows } = await db.query(
    `SELECT key, value FROM app_settings WHERE key = ANY($1)`,
    [keys]
  );
  const cfg = { host: '', port: '22', username: '', password: '', remote_path: '/backups' };
  for (const { key, value } of rows) {
    const shortKey = key.replace('sftp_', '');
    cfg[shortKey] = value;
  }
  return cfg;
}

async function saveSftpConfig(cfg) {
  const fields = {
    sftp_host: cfg.host || '',
    sftp_port: String(cfg.port || 22),
    sftp_username: cfg.username || '',
    sftp_password: cfg.password || '',
    sftp_remote_path: cfg.remote_path || '/backups',
  };
  for (const [key, value] of Object.entries(fields)) {
    await db.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value]
    );
  }
}

module.exports = {
  createBackup,
  uploadToSftp,
  listSftpBackups,
  downloadFromSftp,
  deleteFromSftp,
  testSftpConnection,
  restoreBackup,
  getSftpConfig,
  saveSftpConfig,
};
