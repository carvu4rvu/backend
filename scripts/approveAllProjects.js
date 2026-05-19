/**
 * Approve all pending projects and set PUBLIC + published_at.
 * Run: node scripts/approveAllProjects.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');

async function main() {
  const before = await pool.query(
    `SELECT project_status, visibility, COUNT(*)::int AS c
     FROM projects GROUP BY 1, 2 ORDER BY 1, 2`
  );
  console.log('Before:', before.rows);

  const res = await pool.query(
    `UPDATE projects
     SET project_status = 'approved',
         visibility = 'PUBLIC',
         published_at = COALESCE(published_at, NOW()),
         updated_at = NOW()
     WHERE LOWER(TRIM(project_status::text)) <> 'approved'
        OR UPPER(TRIM(COALESCE(visibility::text, 'PRIVATE'))) <> 'PUBLIC'
     RETURNING id, title, owner_usn, project_status, visibility`
  );

  console.log(`Approved and published ${res.rowCount} project(s):`);
  res.rows.forEach((r) => {
    console.log(`  #${r.id} ${r.title} (${r.owner_usn})`);
  });

  const after = await pool.query(
    `SELECT project_status, visibility, COUNT(*)::int AS c
     FROM projects GROUP BY 1, 2 ORDER BY 1, 2`
  );
  console.log('After:', after.rows);

  const alumni = await pool.query(
    `SELECT COUNT(*)::int AS c FROM projects
     WHERE LOWER(TRIM(project_status::text)) = 'approved'
       AND UPPER(TRIM(COALESCE(visibility::text, 'PRIVATE'))) = 'PUBLIC'`
  );
  console.log(`Alumni showcase eligible: ${alumni.rows[0].c}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
