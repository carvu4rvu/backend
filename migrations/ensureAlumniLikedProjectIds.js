/**
 * Ensure alumni table has liked_project_ids column (for alumni project likes).
 * Run on startup. Safe to run multiple times.
 */
const pool = require('../config/db');

const ensureAlumniLikedProjectIds = async () => {
  try {
    const res = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'alumni' AND column_name = 'liked_project_ids'
    `);
    if (res.rows.length > 0) return;
    await pool.query(`ALTER TABLE public.alumni ADD COLUMN liked_project_ids bigint[] DEFAULT '{}'`);
  } catch (err) {
    console.warn('ensureAlumniLikedProjectIds:', err.message);
  }
};

module.exports = ensureAlumniLikedProjectIds;
