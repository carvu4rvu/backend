require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

async function run() {
  try {
    const basicRes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'student_basic_details'
      ORDER BY column_name
    `);
    
    const profileRes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'student_profile_details'
      ORDER BY column_name
    `);

    console.log('--- student_basic_details ---');
    console.table(basicRes.rows);
    
    console.log('--- student_profile_details ---');
    console.table(profileRes.rows);
    
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

run();
