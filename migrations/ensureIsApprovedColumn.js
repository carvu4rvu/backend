const pool = require('../config/db');

const ensureIsApprovedColumn = async () => {
  try {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'student_projects' AND column_name = 'is_approved'
    `);
    if (res.rows.length === 0) {
      await pool.query('ALTER TABLE public.student_projects ADD COLUMN IF NOT EXISTS is_approved boolean NULL');
      console.log('Added is_approved to student_projects');
    }
  } catch (err) {
    console.warn('ensureIsApprovedColumn:', err.message);
  }
};

module.exports = ensureIsApprovedColumn;
