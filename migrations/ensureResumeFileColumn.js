const pool = require('../config/db');

const ensureResumeFileColumn = async () => {
  console.log('Checking for resume_file column in student_profile_details...');
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'student_profile_details' AND column_name = 'resume_file';
    `);
    if (res.rows.length === 0) {
      console.log('Adding resume_file column...');
      await client.query(`
        ALTER TABLE student_profile_details 
        ADD COLUMN IF NOT EXISTS resume_file text;
      `);
      console.log('resume_file column added successfully.');
    } else {
      console.log('resume_file column already exists.');
    }
  } catch (err) {
    console.error('Error ensuring resume_file column:', err);
  } finally {
    client.release();
  }
};

module.exports = ensureResumeFileColumn;
