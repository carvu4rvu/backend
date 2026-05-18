/**
 * Migration runner: normalize roles to lowercase and dedupe case-insensitively.
 *
 * Usage (from backend folder):
 *   node migrations/normalizeRolesLowercase.js
 *
 * Requires:
 *   DATABASE_URL in environment (.env or process env)
 */
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function run() {
  const sqlPath = path.resolve(__dirname, 'normalize_roles_lowercase.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = await pool.connect();
  try {
    console.log('Running roles normalization migration...');
    await client.query(sql);
    console.log('Done.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  run().catch(() => process.exit(1));
}

module.exports = run;

