/**
 * Reject one job offer for a student (demo / admin helper).
 * Usage: node scripts/rejectStudentOffer.js [USN] [placement-id-suffix]
 * Example: node scripts/rejectStudentOffer.js 1RVU23BSC099 92
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const TARGET_USN = (process.argv[2] || '1RVU23BSC099').trim().toUpperCase();
const PLACEMENT_SUFFIX = (process.argv[3] || '92').trim();
const REJECT_REASON = process.argv[4] || 'Declined — accepted another offer';

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT o.id AS offer_id, o.is_accepted, o.remarks AS offer_remarks,
              p.id AS placement_id, p.designation, p.offer_letter_status, c.company_name
       FROM offers o
       JOIN placement p ON p.id = o.placement_id
       LEFT JOIN companies c ON c.id = p.company_id
       WHERE UPPER(o.student_id) = $1
         AND (p.remarks LIKE $2 OR o.remarks LIKE $2)
       ORDER BY o.id
       LIMIT 1`,
      [TARGET_USN, `%${PLACEMENT_SUFFIX}%`]
    );

    if (!rows.length) {
      console.error('No offer found for', TARGET_USN, 'with suffix', PLACEMENT_SUFFIX);
      process.exit(1);
    }

    const row = rows[0];
    if (row.is_accepted === false) {
      console.log('Already rejected:', row.company_name, row.designation);
      return;
    }

    await client.query(
      `UPDATE offers SET is_accepted = false, remarks = $1, updated_at = NOW() WHERE id = $2`,
      [REJECT_REASON, row.offer_id]
    );
    await client.query(
      `UPDATE placement SET offer_letter_status = 'Declined', updated_at = NOW() WHERE id = $1`,
      [row.placement_id]
    );

    console.log('Rejected offer for', TARGET_USN);
    console.log('  Company:', row.company_name);
    console.log('  Role:', row.designation);
    console.log('  Placement id:', row.placement_id);
    console.log('  Reason:', REJECT_REASON);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
