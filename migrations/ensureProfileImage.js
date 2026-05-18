const pool = require('../config/db');

const ensureProfileImageColumn = async () => {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'student_basic_details' AND column_name = 'profile_image';
    `);

    if (res.rows.length === 0) {
      await client.query(`
        ALTER TABLE student_basic_details 
        ADD COLUMN IF NOT EXISTS profile_image text;
      `);
    }
  } catch (err) {
    console.error('Error ensuring profile_image column:', err);
  } finally {
    client.release();
  }
};

module.exports = ensureProfileImageColumn;
