/**
 * Seed placement drives + round progress + job offers for a student (dashboard demo).
 * Usage: node scripts/seedStudentDashboardDemo.js [USN]
 * Default USN: 1RVU23BSC099
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const TARGET_USN = (process.argv[2] || '1RVU23BSC099').trim().toUpperCase();
const MIN_DRIVES = 10;
const OFFER_COUNT = 2;
const ACADEMIC_YEAR = '2025-26';

const ROUND_FIELDS = [
  'oa_status',
  'gd_status',
  'technical_round_status',
  'interview_status',
  'hr_round_status',
];

function chance(rng, p) {
  return rng() < p;
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Spread drive registrations across distinct weeks for the dashboard timeline chart. */
function timelineDateForIndex(index, total) {
  const weeksBack = Math.max(0, total - index - 1);
  const d = new Date();
  d.setHours(14, 30, 0, 0);
  d.setDate(d.getDate() - weeksBack * 7 - (index % 4));
  return d;
}

/** Random round flags — high pass rates so dashboard stat cards show activity. */
function randomRoundStatuses(rng) {
  const passRates = [0.9, 0.85, 0.82, 0.78, 0.72];
  const fields = {
    malpractice: false,
    attendance: chance(rng, 0.92) ? 'present' : 'absent',
    remarks: null,
  };
  ROUND_FIELDS.forEach((field, i) => {
    fields[field] = chance(rng, passRates[i]);
  });
  if (fields.hr_round_status || fields.interview_status) {
    fields.final_select_status = chance(rng, 0.4);
  } else {
    fields.final_select_status = false;
  }
  return fields;
}

async function main() {
  const client = await pool.connect();
  const rng = () => Math.random();

  try {
    const { rows: students } = await client.query(
      `SELECT usn, full_name, opt_in, school_id, program_id
       FROM student_basic_details WHERE UPPER(usn) = $1`,
      [TARGET_USN]
    );
    if (!students.length) {
      console.error('Student not found:', TARGET_USN);
      process.exit(1);
    }
    const student = students[0];
    console.log('Student:', student.usn, student.full_name, 'opt_in=', student.opt_in);

    await client.query(
      `UPDATE student_basic_details
       SET opt_in = true, has_agreed_placement_policy = true, is_placement_eligible = true
       WHERE UPPER(usn) = $1`,
      [TARGET_USN]
    );

    const { rows: existingProcess } = await client.query(
      `SELECT placement_drive_id FROM student_placement_process WHERE UPPER(usn) = $1`,
      [TARGET_USN]
    );
    const existingDriveIds = new Set(existingProcess.map((r) => String(r.placement_drive_id)));

    const need = Math.max(0, MIN_DRIVES - existingDriveIds.size);
    const { rows: drives } = await client.query(
      `SELECT pd.id, pd.company_id, pd.job_description, pd.placement_status, c.company_name
       FROM placements_drives pd
       LEFT JOIN companies c ON c.id = pd.company_id
       WHERE pd.company_id IS NOT NULL
       ORDER BY
         CASE pd.placement_status
           WHEN 'Completed' THEN 0
           WHEN 'Ongoing' THEN 1
           WHEN 'Scheduled' THEN 2
           ELSE 3
         END,
         pd.id DESC
       LIMIT $1`,
      [need > 0 ? need + 20 : 5]
    );

    const drivesToAdd = drives.filter((d) => !existingDriveIds.has(String(d.id))).slice(0, need);
    let processInserted = 0;
    let processUpdated = 0;

    for (const drive of drivesToAdd) {
      const rounds = randomRoundStatuses(rng);
      const attendedAt = timelineDateForIndex(existingDriveIds.size + processInserted, MIN_DRIVES);
      await client.query(
        `INSERT INTO student_placement_process (
          usn, placement_drive_id, is_eligible, registration_status, approved_status,
          oa_status, gd_status, technical_round_status, interview_status, hr_round_status,
          final_select_status, malpractice, attendance, remarks, created_at, updated_at
        ) VALUES ($1,$2,true,'Registered','Qualified',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
        [
          TARGET_USN,
          drive.id,
          rounds.oa_status,
          rounds.gd_status,
          rounds.technical_round_status,
          rounds.interview_status,
          rounds.hr_round_status,
          rounds.final_select_status,
          rounds.malpractice,
          rounds.attendance,
          rounds.remarks || `Demo seed — ${drive.company_name || 'Drive'}`,
          attendedAt,
        ]
      );
      processInserted++;
      await client.query(
        `UPDATE placements_drives SET number_of_registrations = (
           SELECT COUNT(*)::int FROM student_placement_process WHERE placement_drive_id = $1
         ), updated_at = NOW() WHERE id = $1`,
        [drive.id]
      );
    }

    const { rows: allProcess } = await client.query(
      `SELECT id, placement_drive_id FROM student_placement_process WHERE UPPER(usn) = $1 ORDER BY id ASC`,
      [TARGET_USN]
    );

    const processTotal = allProcess.length;
    for (let i = 0; i < allProcess.length; i++) {
      const row = allProcess[i];
      const rounds = randomRoundStatuses(rng);
      const attendedAt = timelineDateForIndex(i, processTotal);
      await client.query(
        `UPDATE student_placement_process SET
          is_eligible = true,
          registration_status = 'Registered',
          approved_status = 'Qualified',
          oa_status = $1,
          gd_status = $2,
          technical_round_status = $3,
          interview_status = $4,
          hr_round_status = $5,
          final_select_status = $6,
          malpractice = false,
          attendance = COALESCE(attendance, 'present'),
          created_at = $7,
          updated_at = $7
         WHERE id = $8`,
        [
          rounds.oa_status,
          rounds.gd_status,
          rounds.technical_round_status,
          rounds.interview_status,
          rounds.hr_round_status,
          rounds.final_select_status,
          attendedAt,
          row.id,
        ]
      );
      processUpdated++;
    }

    const { rows: offerPlacements } = await client.query(
      `SELECT p.id FROM placement p WHERE UPPER(p.student_id) = $1`,
      [TARGET_USN]
    );
    let offersCreated = 0;
    const designations = ['Software Engineer', 'Associate Consultant'];

    const offerDrives = await client.query(
      `SELECT DISTINCT pd.id, pd.company_id, pd.job_description, c.company_name
       FROM placements_drives pd
       JOIN companies c ON c.id = pd.company_id
       WHERE pd.company_id IS NOT NULL
       ORDER BY pd.id DESC
       LIMIT $1`,
      [OFFER_COUNT + 5]
    );

    const existingOfferCount = offerPlacements.length;
    const offersNeeded = Math.max(0, OFFER_COUNT - existingOfferCount);

    for (let i = 0; i < offersNeeded && i < offerDrives.rows.length; i++) {
      const drive = offerDrives.rows[i];
      const designation = designations[i % designations.length];
      const remarkTag = `(dashboard-demo-${TARGET_USN}-${drive.id})`;

      const dup = await client.query(
        `SELECT id FROM placement WHERE student_id = $1 AND remarks = $2`,
        [TARGET_USN, remarkTag]
      );
      if (dup.rows.length) continue;

      const cmin = 12 + i * 3;
      const cmax = cmin + 6;
      const pl = await client.query(
        `INSERT INTO placement (
          student_id, company_id, designation, offer_letter_status,
          ctc_min_lpa, ctc_max_lpa, type_of_hiring, academic_year, remarks, job_description
        ) VALUES ($1,$2,$3,'Accepted',$4,$5,'Full Time',$6,$7,$8)
        RETURNING id`,
        [
          TARGET_USN,
          drive.company_id,
          designation,
          cmin,
          cmax,
          ACADEMIC_YEAR,
          remarkTag,
          drive.job_description || `${designation} at ${drive.company_name}`,
        ]
      );

      await client.query(
        `INSERT INTO offers (student_id, company_id, placement_id, job_type, academic_year, remarks, is_accepted)
         VALUES ($1,$2,$3,'Full Time',$4,$5,true)`,
        [TARGET_USN, drive.company_id, pl.rows[0].id, ACADEMIC_YEAR, remarkTag]
      );
      offersCreated++;
    }

    const summary = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM student_placement_process WHERE UPPER(usn) = $1) AS applications,
         (SELECT COUNT(*)::int FROM student_placement_process WHERE UPPER(usn) = $1 AND oa_status = true) AS oa_passed,
         (SELECT COUNT(*)::int FROM student_placement_process WHERE UPPER(usn) = $1 AND gd_status = true) AS gd_passed,
         (SELECT COUNT(*)::int FROM student_placement_process WHERE UPPER(usn) = $1 AND technical_round_status = true) AS tech_passed,
         (SELECT COUNT(*)::int FROM student_placement_process WHERE UPPER(usn) = $1 AND interview_status = true) AS interview_passed,
         (SELECT COUNT(*)::int FROM student_placement_process WHERE UPPER(usn) = $1 AND hr_round_status = true) AS hr_passed,
         (SELECT COUNT(DISTINCT COALESCE(pd.company_id::text, spp.placement_drive_id::text))::int
          FROM student_placement_process spp
          JOIN placements_drives pd ON pd.id = spp.placement_drive_id
          WHERE UPPER(spp.usn) = $1) AS companies,
         (SELECT COUNT(*)::int FROM placement WHERE UPPER(student_id) = $1) AS placements`,
      [TARGET_USN]
    );

    console.log('\nDone for', TARGET_USN);
    console.log('  Process rows inserted:', processInserted);
    console.log('  Process rows updated (rounds):', processUpdated);
    console.log('  New offers created:', offersCreated);
    console.log('  Dashboard summary:', summary.rows[0]);
    console.log('\nRefresh /student-dashboard as this student.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
