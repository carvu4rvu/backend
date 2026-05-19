/**
 * Create missing user_login rows for converted alumni (personal Gmail + alumni role).
 * Uses the same password as the student's RVU (college) login when available.
 *
 * Run from backend:
 *   node scripts/repairAlumniPersonalLogins.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const alumniDb = require('../db/alumniDb');

async function main() {
  const roleRes = await pool.query("SELECT id FROM roles WHERE lower(name) = 'alumni' LIMIT 1");
  const alumniRoleId = roleRes.rows[0]?.id;
  if (!alumniRoleId) {
    console.error('Alumni role not found.');
    process.exit(1);
  }

  const { rows: alumni } = await pool.query(`
    SELECT a.student_id, a.personal_email, s.college_email
    FROM alumni a
    LEFT JOIN student_basic_details s ON s.usn = a.student_id
    WHERE a.personal_email IS NOT NULL AND TRIM(a.personal_email) <> ''
  `);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of alumni) {
    const personalEmail = String(row.personal_email).trim().toLowerCase();
    const collegeEmail = row.college_email ? String(row.college_email).trim().toLowerCase() : null;

    const existingPersonal = await pool.query(
      `SELECT ul.id FROM user_login ul
       JOIN roles r ON r.id = ul.role_id
       WHERE lower(ul.email_id) = lower($1) AND lower(r.name) = 'alumni'`,
      [personalEmail]
    );
    if (existingPersonal.rows.length > 0) {
      skipped += 1;
      continue;
    }

    let passwordHash = null;
    if (collegeEmail) {
      const collegeLogin = await pool.query(
        `SELECT password_hash FROM user_login WHERE lower(email_id) = lower($1) AND is_active = true LIMIT 1`,
        [collegeEmail]
      );
      passwordHash = collegeLogin.rows[0]?.password_hash || null;
    }

    if (!passwordHash) {
      console.warn(`Skip ${row.student_id || personalEmail}: no college login password to copy`);
      failed += 1;
      continue;
    }

    const result = await alumniDb.ensurePersonalAlumniLogin({
      personalEmail,
      alumniRoleId,
      passwordHash,
    });

    if (result.error && !result.loginId) {
      console.warn(`Failed ${personalEmail}: ${result.error}`);
      failed += 1;
    } else if (result.created) {
      created += 1;
      console.log(`Created login: ${personalEmail}`);
    } else {
      updated += 1;
      console.log(`Updated login: ${personalEmail}`);
    }
  }

  console.log(`Done. created=${created} updated=${updated} skipped=${skipped} failed=${failed}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
