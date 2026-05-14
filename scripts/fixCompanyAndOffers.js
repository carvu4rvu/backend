/**
 * Fix company and offers linkage so the company portal shows correct data.
 * - Sets offers.company_id from placement where missing or wrong
 * - Sets placement.company_id from offers where placement has null
 * - Ensures company-role users in user_login have company_id set (to a company that has drives/offers)
 *
 * Run from backend: node scripts/fixCompanyAndOffers.js
 * Requires .env with DATABASE_URL (Postgres connection string; Supabase project URI is fine).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

async function run() {
  const client = await pool.connect();
  try {
    console.log('--- Fix offers.company_id from placement ---');
    const r1 = await client.query(`
      UPDATE offers o
      SET company_id = p.company_id
      FROM placement p
      WHERE o.placement_id = p.id
        AND p.company_id IS NOT NULL
        AND (o.company_id IS NULL OR o.company_id != p.company_id)
    `);
    console.log('Offers updated (company_id from placement):', r1.rowCount);

    console.log('--- Fix placement.company_id from offers where placement has null ---');
    const r2 = await client.query(`
      UPDATE placement p
      SET company_id = o.company_id
      FROM offers o
      WHERE o.placement_id = p.id
        AND o.company_id IS NOT NULL
        AND p.company_id IS NULL
    `);
    console.log('Placement rows updated (company_id from offers):', r2.rowCount);

    console.log('--- Ensure placements_drives have valid company_id (report only) ---');
    const drivesNull = await client.query(`
      SELECT id, company_id, academic_year FROM placements_drives WHERE company_id IS NULL
    `);
    if (drivesNull.rows.length > 0) {
      console.log('Drives with null company_id (fix manually or delete):', drivesNull.rows);
    } else {
      console.log('All placements_drives have company_id set.');
    }

    console.log('--- Fix google@gmail.com (and company 1) linkage ---');
    const companyOne = await client.query('SELECT id FROM companies WHERE id = 1');
    if (companyOne.rows.length > 0) {
      const roleCompany = await client.query("SELECT id FROM roles WHERE name = 'company'");
      const companyRoleIdForGoogle = roleCompany.rows[0]?.id;
      if (companyRoleIdForGoogle) {
        const rGoogle = await client.query(
          `UPDATE user_login SET company_id = 1, updated_at = now()
           WHERE LOWER(TRIM(email_id)) = 'google@gmail.com' AND role_id = $1 AND (company_id IS NULL OR company_id != 1)
           RETURNING id, email_id`,
          [companyRoleIdForGoogle]
        );
        if (rGoogle.rowCount > 0) {
          console.log('Set company_id = 1 for user(s):', rGoogle.rows.map((r) => r.email_id).join(', '));
        } else {
          const check = await client.query(
            `SELECT id, email_id, company_id FROM user_login WHERE role_id = $1 AND (LOWER(email_id) LIKE '%google%' OR company_id = 1)`,
            [companyRoleIdForGoogle]
          );
          if (check.rows.length > 0) {
            console.log('Company users with google or company_id 1:', check.rows);
          }
        }
      }
    }

    console.log('--- Company role and user_login linkage ---');
    const roleRes = await client.query("SELECT id FROM roles WHERE name = 'company'");
    const companyRoleId = roleRes.rows[0]?.id;
    if (!companyRoleId) {
      console.log('No role named "company" found. Skip user_login company_id assignment.');
    } else {
      const companiesWithDrivesOrOffers = await client.query(`
        SELECT DISTINCT c.id, c.company_name
        FROM companies c
        WHERE EXISTS (SELECT 1 FROM placements_drives pd WHERE pd.company_id = c.id)
           OR EXISTS (SELECT 1 FROM offers o WHERE o.company_id = c.id)
        ORDER BY c.id
      `);
      const companiesWithLogin = await client.query(`
        SELECT DISTINCT company_id FROM user_login
        WHERE company_id IS NOT NULL AND role_id = $1
      `, [companyRoleId]);
      const withLoginSet = new Set(companiesWithLogin.rows.map((r) => r.company_id));
      const companiesNeedingLogin = companiesWithDrivesOrOffers.rows.filter((c) => !withLoginSet.has(Number(c.id)));
      const usersWithoutCompany = await client.query(`
        SELECT id, email_id FROM user_login
        WHERE role_id = $1 AND company_id IS NULL
        ORDER BY id
      `, [companyRoleId]);

      console.log('Companies with drives or offers:', companiesWithDrivesOrOffers.rows.length);
      console.log('Company users without company_id:', usersWithoutCompany.rows.length);
      console.log('Companies with drives/offers but no company login:', companiesNeedingLogin.length);

      for (let i = 0; i < Math.min(usersWithoutCompany.rows.length, companiesNeedingLogin.length); i++) {
        const user = usersWithoutCompany.rows[i];
        const company = companiesNeedingLogin[i];
        await client.query(
          'UPDATE user_login SET company_id = $1, updated_at = now() WHERE id = $2',
          [company.id, user.id]
        );
        console.log('Assigned company_id', company.id, '(' + company.company_name + ') to user', user.email_id);
      }
      if (companiesNeedingLogin.length > usersWithoutCompany.rows.length) {
        console.log('Note: some companies still have no company-role login. Add logins via admin or register-company API.');
      }

      // If a company user's company has no drives/offers, reassign to a company that has drives so they can see data
      const usersWithCompany = await client.query(`
        SELECT ul.id, ul.email_id, ul.company_id
        FROM user_login ul
        WHERE ul.role_id = $1 AND ul.company_id IS NOT NULL
      `, [companyRoleId]);
      for (const u of usersWithCompany.rows) {
        const hasDrive = await client.query(
          'SELECT 1 FROM placements_drives WHERE company_id = $1 LIMIT 1',
          [u.company_id]
        );
        const hasOffer = await client.query(
          'SELECT 1 FROM offers WHERE company_id = $1 LIMIT 1',
          [u.company_id]
        );
        if (hasDrive.rows.length > 0 || hasOffer.rows.length > 0) continue;
        const withDrive = await client.query(
          `SELECT c.id FROM companies c
           WHERE EXISTS (SELECT 1 FROM placements_drives pd WHERE pd.company_id = c.id)
           ORDER BY c.id LIMIT 1`
        );
        if (withDrive.rows.length === 0) continue;
        const newCid = withDrive.rows[0].id;
        await client.query(
          'UPDATE user_login SET company_id = $1, updated_at = now() WHERE id = $2',
          [newCid, u.id]
        );
        console.log('Reassigned user', u.email_id, 'to company_id', newCid, '(had no drives/offers)');
      }
    }

    console.log('--- Link offer students to placement drives (student_placement_process) ---');
    const offerStudents = await client.query(`
      SELECT DISTINCT o.student_id, o.company_id
      FROM offers o
      WHERE o.company_id IS NOT NULL
    `);
    let processInserts = 0;
    for (const row of offerStudents.rows) {
      const usn = row.student_id;
      const companyId = row.company_id;
      const drives = await client.query(
        'SELECT id FROM placements_drives WHERE company_id = $1 ORDER BY id LIMIT 1',
        [companyId]
      );
      if (drives.rows.length === 0) continue;
      const driveId = drives.rows[0].id;
      const exists = await client.query(
        'SELECT 1 FROM student_placement_process WHERE placement_drive_id = $1 AND usn = $2',
        [driveId, usn]
      );
      if (exists.rows.length > 0) continue;
      const ins = await client.query(
        `INSERT INTO student_placement_process (placement_drive_id, usn, is_eligible, registration_status)
         VALUES ($1, $2, true, 'Registered')`,
        [driveId, usn]
      );
      if (ins.rowCount > 0) processInserts++;
    }
    console.log('student_placement_process rows added for offer students:', processInserts);

    console.log('\n--- Done ---');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
