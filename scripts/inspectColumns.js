require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

async function run() {
  const table = process.argv[2];
  if (!table) {
    console.error('Usage: node scripts/inspectColumns.js <table_name>');
    process.exit(1);
  }
  const q = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  for (const row of q.rows) {
    console.log(`${row.column_name}|${row.data_type}|${row.is_nullable}|${row.column_default || ''}`);
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
