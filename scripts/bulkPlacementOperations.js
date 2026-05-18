/**
 * One-time bulk operations for placements:
 * 1) Opt-in all students to placements.
 * 2) Delete 10-15 upcoming drives (targets 12 when available).
 * 3) Ensure every remaining drive has 3-5 rounds.
 * 4) Add all students into all remaining drives.
 * 5) Mark each configured round as processed in student_placement_process.
 *
 * Run from backend:
 *   node scripts/bulkPlacementOperations.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const TARGET_DELETE_UPCOMING = 12;
const ROUND_TEMPLATES = [
  ['OA', 'GD', 'Technical'],
  ['OA', 'Technical', 'Interview'],
  ['GD', 'Technical', 'HR'],
  ['OA', 'GD', 'Technical', 'Interview'],
  ['OA', 'Technical', 'Interview', 'HR'],
  ['OA', 'GD', 'Technical', 'Interview', 'HR'],
];

const ROUND_TO_FIELD = {
  OA: 'oa_status',
  GD: 'gd_status',
  Technical: 'technical_round_status',
  Interview: 'interview_status',
  HR: 'hr_round_status',
};

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const client = await pool.connect();
  try {
  console.log('Starting bulk placement operations...\n');

  // 1) Opt-in all students.
  const studentsRes = await client.query(
    `SELECT usn FROM student_basic_details WHERE usn IS NOT NULL`
  );
  const usns = (studentsRes.rows || []).map((s) => s.usn).filter(Boolean);
  if (usns.length === 0) {
    console.log('No students found. Stopping.');
    return;
  }

  await client.query(
    `UPDATE student_basic_details
     SET opt_in = true,
         is_registered = true`
  );
  console.log(`Students opted-in: ${usns.length}`);

  // 2) Fetch drives and delete upcoming drives.
  const drivesRes = await client.query(
    `SELECT id, placement_status, event_datetime, process_rounds
     FROM placements_drives`
  );
  const drives = drivesRes.rows || [];
  if (!drives || drives.length === 0) {
    console.log('No drives found. Stopping.');
    return;
  }

  const upcoming = drives
    .filter((d) => {
      const s = String(d.placement_status || '').toLowerCase();
      return s === 'scheduled' || s === 'upcoming' || s === 'open';
    })
    .sort((a, b) => new Date(a.event_datetime || 0) - new Date(b.event_datetime || 0));

  const deleteCount = Math.min(TARGET_DELETE_UPCOMING, upcoming.length);
  const toDelete = upcoming.slice(0, deleteCount).map((d) => d.id);

  if (toDelete.length > 0) {
    // Remove process rows first to avoid FK violations where cascade is not configured.
    await client.query(
      `DELETE FROM student_placement_process WHERE placement_drive_id = ANY($1::bigint[])`,
      [toDelete]
    );
    await client.query(
      `DELETE FROM placements_drives WHERE id = ANY($1::bigint[])`,
      [toDelete]
    );
  }
  console.log(`Upcoming drives deleted: ${toDelete.length}`);

  // 3) Reload drives and enforce 3-5 rounds on each.
  const remainingRes = await client.query(
    `SELECT id, process_rounds FROM placements_drives ORDER BY id ASC`
  );
  const remainingDrives = remainingRes.rows || [];
  if (!remainingDrives || remainingDrives.length === 0) {
    console.log('No drives left after deletion.');
    return;
  }

  const driveRoundsMap = new Map();
  for (let i = 0; i < remainingDrives.length; i++) {
    const drive = remainingDrives[i];
    const rounds = ROUND_TEMPLATES[i % ROUND_TEMPLATES.length];
    driveRoundsMap.set(drive.id, rounds);
    await client.query(
      `UPDATE placements_drives SET process_rounds = $1::text[] WHERE id = $2`,
      [rounds, drive.id]
    );
  }
  console.log(`Drives updated with 3-5 rounds: ${remainingDrives.length}`);

  // 4) Add all students to all drives (insert missing only).
  const driveIds = remainingDrives.map((d) => d.id);
  const insRes = await client.query(
    `INSERT INTO student_placement_process (placement_drive_id, usn, is_eligible, registration_status)
     SELECT d.id, s.usn, true, 'REGISTERED'
     FROM placements_drives d
     CROSS JOIN student_basic_details s
     WHERE d.id = ANY($1::bigint[])
       AND s.usn IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM student_placement_process p
         WHERE p.placement_drive_id = d.id
           AND p.usn = s.usn
       )`,
    [driveIds]
  );
  console.log(`New student-drive process rows inserted: ${insRes.rowCount || 0}`);

  // 5) Mark rounds as processed per drive and set drive registration counts.
  for (const driveId of driveIds) {
    const rounds = driveRoundsMap.get(driveId) || ROUND_TEMPLATES[0];
    const payload = {
      oa_status: null,
      gd_status: null,
      technical_round_status: null,
      interview_status: null,
      hr_round_status: null,
      final_select_status: false,
      updated_at: new Date().toISOString(),
    };
    rounds.forEach((r) => {
      const f = ROUND_TO_FIELD[r];
      if (f) payload[f] = true;
    });
    if (rounds.includes('HR') || rounds.includes('Interview')) {
      payload.final_select_status = true;
    }

    await client.query(
      `UPDATE student_placement_process
       SET oa_status = $1,
           gd_status = $2,
           technical_round_status = $3,
           interview_status = $4,
           hr_round_status = $5,
           final_select_status = $6
       WHERE placement_drive_id = $7`,
      [
        payload.oa_status,
        payload.gd_status,
        payload.technical_round_status,
        payload.interview_status,
        payload.hr_round_status,
        payload.final_select_status,
        driveId,
      ]
    );

    await client.query(
      `UPDATE placements_drives
       SET number_of_registrations = $1
       WHERE id = $2`,
      [usns.length, driveId]
    );
  }
  console.log(`Processed round statuses for drives: ${driveIds.length}`);

  console.log('\nBulk placement operations completed successfully.');
  } finally {
    client.release();
    pool.end();
  }
}

main().catch((err) => {
  console.error('Bulk placement operations failed:', err?.message || err);
  process.exit(1);
});
