/**
 * Lock semester academics for one student.
 * Usage: node scripts/lockStudentSemesters.js [USN] [sem1,sem2,...]
 * Example: node scripts/lockStudentSemesters.js 1RVU23BSC099 1,2,3
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const TARGET_USN = (process.argv[2] || '1RVU23BSC099').trim().toUpperCase();
const SEM_ARG = process.argv[3] || '1,2,3';
const semesters = SEM_ARG.split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => n >= 1 && n <= 8);

async function main() {
  if (!semesters.length) {
    console.error('Provide semester numbers 1–8, e.g. 1,2,3');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const { rows: students } = await client.query(
      `SELECT usn FROM student_basic_details WHERE UPPER(usn) = $1`,
      [TARGET_USN]
    );
    if (!students.length) {
      console.error('Student not found:', TARGET_USN);
      process.exit(1);
    }

    await client.query(
      `INSERT INTO public.student_edit_control (usn) VALUES ($1) ON CONFLICT (usn) DO NOTHING`,
      [TARGET_USN]
    );

    const setParts = semesters.map((n) => `is_sem${n}_locked = true`);
    const { rows } = await client.query(
      `UPDATE public.student_edit_control
       SET ${setParts.join(', ')}
       WHERE UPPER(usn) = $1
       RETURNING usn,
         is_sem1_locked, is_sem2_locked, is_sem3_locked, is_sem4_locked,
         is_sem5_locked, is_sem6_locked, is_sem7_locked, is_sem8_locked`,
      [TARGET_USN]
    );

    const r = rows[0];
    console.log('Locked semesters for', TARGET_USN, ':', semesters.join(', '));
    semesters.forEach((n) => {
      console.log(`  Sem ${n}: locked`);
    });
    console.log('\nCurrent semester lock flags:');
    for (let i = 1; i <= 8; i++) {
      const locked = r[`is_sem${i}_locked`];
      if (locked) console.log(`  Sem ${i}: locked`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
