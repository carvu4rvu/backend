const pool = require('../config/db');

const ensureProfileImageColumn = async () => {
  console.log('Checking for profile_image column...');
  const client = await pool.connect();
  try {
    // Check if column exists
    const res = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'student_basic_details' AND column_name = 'profile_image';
    `);

    if (res.rows.length === 0) {
      console.log('Adding profile_image column...');
      await client.query(`
        ALTER TABLE student_basic_details 
        ADD COLUMN IF NOT EXISTS profile_image text;
      `);
      console.log('profile_image column added successfully.');
    } else {
      console.log('profile_image column already exists.');
    }
  } catch (err) {
    console.error('Error ensuring profile_image column:', err);
  } finally {
    client.release();
  }
};

module.exports = ensureProfileImageColumn;
