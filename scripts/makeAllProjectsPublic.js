/**
 * Set every project in the database to PUBLIC visibility.
 * Run: node scripts/makeAllProjectsPublic.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');

async function main() {
  const before = await pool.query(
    `SELECT UPPER(TRIM(COALESCE(visibility::text, 'PRIVATE'))) AS visibility, COUNT(*)::int AS c
     FROM projects GROUP BY 1 ORDER BY 1`
  );
  console.log('Before:', before.rows);

  const res = await pool.query(
    `UPDATE projects
     SET visibility = 'PUBLIC',
         published_at = COALESCE(published_at, NOW()),
         updated_at = NOW()
     WHERE UPPER(TRIM(COALESCE(visibility::text, 'PRIVATE'))) <> 'PUBLIC'
     RETURNING id, title, owner_usn, project_status`
  );

  const after = await pool.query(
    `SELECT UPPER(TRIM(COALESCE(visibility::text, 'PRIVATE'))) AS visibility, COUNT(*)::int AS c
     FROM projects GROUP BY 1 ORDER BY 1`
  );
  console.log(`Updated ${res.rowCount} project(s) to PUBLIC.`);
  res.rows.forEach((r) => {
    console.log(`  #${r.id} [${r.project_status}] ${r.title} (${r.owner_usn})`);
  });
  console.log('After:', after.rows);

  const total = await pool.query('SELECT COUNT(*)::int AS c FROM projects');
  console.log(`Total projects: ${total.rows[0].c}, all should be PUBLIC.`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
