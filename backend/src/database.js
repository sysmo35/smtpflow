const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

const pool = new Pool(config.db);

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error', err);
});

async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn('Slow query', { text: text.substring(0, 100), duration });
    }
    return res;
  } catch (err) {
    logger.error('DB query error', { text: text.substring(0, 100), err: err.message });
    throw err;
  }
}

async function migrate() {
  const sqlFile = path.join(__dirname, '../migrations/init.sql');
  const sql = fs.readFileSync(sqlFile, 'utf-8');
  const client = await pool.connect();
  try {
    await client.query(sql);
    logger.info('Database migration completed');
  } catch (err) {
    logger.error('Migration failed', err);
    throw err;
  } finally {
    client.release();
  }
}

async function testConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT NOW()');
    logger.info('Database connection OK');
    return true;
  } catch (err) {
    logger.error('Database connection failed', err);
    return false;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { query, pool, migrate, testConnection };
