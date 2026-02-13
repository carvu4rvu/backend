/**
 * Migration: Change project_status to 4 values.
 * Old: draft, submitted, approved, rejected, archived
 * New: not_approved, approved, rejected, archived
 *
 * 1. First update your DB enum/constraint to allow: not_approved, approved, rejected, archived
 * 2. Then run: node migrations/projectStatusToFourValues.js
 */
require('dotenv').config({ quiet: true });
const pool = require('../config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    const r = await client.query(`
      UPDATE projects
      SET project_status = 'not_approved'
      WHERE project_status IN ('draft', 'submitted')
    `);
    console.log(`[projectStatus] Updated ${r.rowCount} rows from draft/submitted to not_approved`);
    console.log('[projectStatus] Migration complete.');
  } finally {
    client.release();
    pool.end();
  }
}

migrate().catch((err) => {
  console.error('[projectStatus] Migration failed:', err);
  process.exit(1);
});
