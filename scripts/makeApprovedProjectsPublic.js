/**
 * One-time helper: set all approved projects to PUBLIC and set published_at if missing.
 * Run: node scripts/makeApprovedProjectsPublic.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');

async function main() {
  const res = await pool.query(
    `UPDATE projects
     SET visibility = 'PUBLIC',
         published_at = COALESCE(published_at, NOW()),
         updated_at = NOW()
     WHERE LOWER(TRIM(project_status::text)) = 'approved'
       AND UPPER(TRIM(COALESCE(visibility::text, 'PRIVATE'))) <> 'PUBLIC'
     RETURNING id, title, owner_usn`
  );
  console.log(`Updated ${res.rowCount} approved project(s) to PUBLIC.`);
  res.rows.slice(0, 20).forEach((r) => console.log(`  #${r.id} ${r.title} (${r.owner_usn})`));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
