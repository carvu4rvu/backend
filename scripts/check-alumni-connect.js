require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');

(async () => {
  try {
    const t = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'alumni_connection_requests'
      ORDER BY ordinal_position
    `);
    console.log('COLUMNS:', t.rows.map((r) => r.column_name).join(', ') || 'TABLE MISSING');
    const c = await pool.query('SELECT COUNT(*)::int AS n FROM alumni_connection_requests');
    console.log('COUNT:', c.rows[0].n);
    const rows = await pool.query(
      'SELECT id, alumni_id, student_usn, status, connection_purpose, created_at FROM alumni_connection_requests ORDER BY id DESC LIMIT 5'
    );
    console.log('SAMPLE:', JSON.stringify(rows.rows, null, 2));
    const alumni = await pool.query('SELECT id, full_name, personal_email FROM alumni LIMIT 3');
    console.log('ALUMNI:', JSON.stringify(alumni.rows, null, 2));
    const students = await pool.query('SELECT usn, full_name FROM student_basic_details LIMIT 3');
    console.log('STUDENTS:', JSON.stringify(students.rows, null, 2));
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    await pool.end();
  }
})();
