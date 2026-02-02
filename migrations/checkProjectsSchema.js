const pool = require('../config/db');

const checkProjectsSchema = async () => {
  console.log('Checking columns in student_projects...');
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'student_projects';
    `);
    console.log(res.rows);
  } catch (err) {
    console.error('Error checking schema:', err);
  } finally {
    client.release();
    process.exit();
  }
};

checkProjectsSchema();
