require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

async function run() {
  const table = process.argv[2];
  if (!table) {
    console.error('Usage: node scripts/inspectConstraints.js <table_name>');
    process.exit(1);
  }
  const q = await pool.query(
    `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c
     JOIN pg_class t ON c.conrelid = t.oid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname = $1
     ORDER BY c.conname`,
    [table]
  );
  for (const row of q.rows) {
    console.log(`${row.conname}: ${row.def}`);
  }
}

run()
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
