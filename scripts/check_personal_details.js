require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

async function run() {
  try {
    const res = await pool.query(`
      SELECT 
        COUNT(*) as total_students,
        COUNT(gender) as gender_filled,
        COUNT(date_of_birth) as dob_filled,
        COUNT(blood_group) as blood_group_filled,
        COUNT(languages) as languages_filled,
        COUNT(phone_number) as phone_filled,
        COUNT(personal_email) as personal_email_filled,
        COUNT(section) as section_filled
      FROM student_basic_details
    `);

    console.log('--- Personal Details Completion Status ---');
    console.table(res.rows);

    const sample = await pool.query(`
      SELECT 
        usn, full_name, gender, date_of_birth, blood_group, languages, section, specially_abled
      FROM student_basic_details
      LIMIT 5
    `);
    console.log('--- Sample Data ---');
    console.table(sample.rows);
    
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

run();
