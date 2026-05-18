const { Pool } = require('pg');
require('dotenv').config();
const { validateDatabaseUrl } = require('../utils/supabaseDiagnostics');

const isProduction = process.env.NODE_ENV === 'production';

const dbUrlCheck = validateDatabaseUrl(process.env.DATABASE_URL);
if (dbUrlCheck.warning) {
  console.warn(`[postgres] ${dbUrlCheck.warning}`);
}

/** Single shared pool for the entire backend process. */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PG_POOL_MAX) || 20,
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30000,
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 5000,
});

let hasLoggedFirstConnection = false;

pool.on('connect', () => {
  if (!hasLoggedFirstConnection) {
    hasLoggedFirstConnection = true;
    console.log('[postgres] pool ready (first connection established)');
  }
});

pool.on('error', (err) => {
  console.error('[postgres] unexpected idle client error:', err.message);
});

async function gracefulPoolShutdown() {
  try {
    await pool.end();
    console.log('[postgres] pool closed');
  } catch (err) {
    console.error('[postgres] pool shutdown error:', err.message);
  }
}

module.exports = pool;
module.exports.gracefulPoolShutdown = gracefulPoolShutdown;
module.exports.getPoolConfig = () => ({
  max: Number(process.env.PG_POOL_MAX) || 20,
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30000,
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 5000,
  ssl: isProduction,
  usesPooler: (process.env.DATABASE_URL || '').includes('pooler.supabase.com'),
});
