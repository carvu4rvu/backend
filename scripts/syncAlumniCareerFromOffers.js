/**
 * Backfill alumni.current_company / current_designation from accepted offers.
 *
 * Run from backend:
 *   node scripts/syncAlumniCareerFromOffers.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const alumniDb = require('../db/alumniDb');

async function main() {
  const { rows: alumni } = await pool.query(
    `SELECT id, student_id, current_company, current_designation
     FROM alumni
     WHERE student_id IS NOT NULL`
  );

  let updated = 0;
  let skipped = 0;

  for (const row of alumni) {
    const career = await alumniDb.getAcceptedOfferCareerForStudent(row.student_id);
    if (!career?.company_name && !career?.designation) {
      skipped += 1;
      continue;
    }

    const merged = alumniDb.mergeAlumniCareerFields(row, career);
    const companyChanged = merged.current_company !== row.current_company;
    const roleChanged = merged.current_designation !== row.current_designation;
    if (!companyChanged && !roleChanged) {
      skipped += 1;
      continue;
    }

    await pool.query(
      `UPDATE alumni
       SET current_company = $2, current_designation = $3, updated_at = NOW()
       WHERE id = $1`,
      [row.id, merged.current_company, merged.current_designation]
    );
    updated += 1;
    console.log(
      `${row.student_id}: ${merged.current_designation || '—'} @ ${merged.current_company || '—'}`
    );
  }

  console.log(`Done. updated=${updated} skipped=${skipped}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
