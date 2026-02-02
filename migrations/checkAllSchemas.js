const pool = require('../config/db');

const tables = [
  'student_internships',
  'student_trainings',
  'student_certifications',
  'student_publications',
  'student_extra_curricular_activities',
  'student_other_experiences'
];

const checkAllSchemas = async () => {
  console.log('Checking columns for tables:', tables.join(', '));
  const client = await pool.connect();
  try {
    for (const table of tables) {
      console.log(`\n--- ${table} ---`);
      const res = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1;
      `, [table]);
      res.rows.forEach(row => {
          if (row.column_name.includes('proof') || row.column_name.includes('file') || row.column_name.includes('doc') || row.column_name.includes('image') || row.column_name.includes('snap')) {
              console.log(`* ${row.column_name} (${row.data_type})`);
          } else {
             // console.log(`  ${row.column_name}`);
          }
      });
      // console.log(res.rows);
    }
  } catch (err) {
    console.error('Error checking schemas:', err);
  } finally {
    client.release();
    process.exit();
  }
};

checkAllSchemas();
