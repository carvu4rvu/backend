require('dotenv').config();
const pool = require('../config/db');

(async () => {
  const v = await pool.query(`
    SELECT v.usn AS v_usn, s.usn AS s_usn
    FROM student_placement_violations v
    LEFT JOIN student_basic_details s ON LOWER(TRIM(s.usn)) = LOWER(TRIM(v.usn))
    WHERE COALESCE(v.is_active, true) = true
  `);
  const missing = v.rows.filter((r) => !r.s_usn);
  console.log('violations:', v.rows.length, 'matched students:', v.rows.length - missing.length);

  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'student_edit_control'
    ORDER BY ordinal_position
  `);
  console.log('student_edit_control:', cols.rows.map((r) => r.column_name).join(', '));

  const elig = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'eligibility_decision_logs'
    ORDER BY ordinal_position
  `);
  console.log('eligibility_decision_logs:', elig.rows.map((r) => r.column_name).join(', '));

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
