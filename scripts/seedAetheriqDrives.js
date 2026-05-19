/**
 * Seed 3 placement drives for Aetheriq:
 * - 1 upcoming (Scheduled)
 * - 2 completed
 * Each drive: 65+ registered students
 * Each completed drive: 12+ job offers (placement + offers rows)
 *
 * Run: node scripts/seedAetheriqDrives.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const COMPANY_NAME_MATCH = 'Aetheriq';
const REGISTRATIONS_PER_DRIVE = 65;
const OFFERS_PER_COMPLETED_DRIVE = 12;
const ACADEMIC_YEAR = '2025-26';

const DESIGNATIONS = [
  'Software Engineer',
  'SDE I',
  'Associate Engineer',
  'Full Stack Developer',
  'Data Engineer',
  'Backend Developer',
  'Frontend Developer',
  'ML Engineer',
  'DevOps Engineer',
  'QA Engineer',
  'Product Engineer',
  'Cloud Engineer',
];

function addDays(d, days) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function loadStudents(client, limit) {
  const { rows } = await client.query(
    `SELECT sbd.usn
     FROM student_basic_details sbd
     WHERE sbd.usn IS NOT NULL
     ORDER BY sbd.usn
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => r.usn);
}

async function insertDrive(client, companyId, spec) {
  const { rows } = await client.query(
    `INSERT INTO placements_drives (
       company_id, academic_year, year, job_type, type_of_hiring, job_description, job_location,
       ctc_structure, process_rounds, number_of_openings, number_of_registrations,
       placement_status, last_date_to_registration, event_datetime, tpo, company_remarks
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::text[],$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      companyId,
      ACADEMIC_YEAR,
      2026,
      spec.job_type,
      'campus',
      spec.job_description,
      spec.job_location,
      JSON.stringify(spec.ctc_structure),
      ['OA', 'GD', 'Technical', 'Interview', 'HR'],
      spec.openings,
      0,
      spec.placement_status,
      spec.last_date_to_registration,
      spec.event_datetime,
      'Placement Office',
      spec.company_remarks,
    ]
  );
  return rows[0];
}

async function registerStudents(client, driveId, usns) {
  const rows = usns.map((usn) => ({
    usn,
    placement_drive_id: driveId,
    is_eligible: true,
    registration_status: 'Registered',
    approved_status: 'Qualified',
  }));

  let inserted = 0;
  for (const batch of chunk(rows, 200)) {
    const values = [];
    const params = [];
    let idx = 1;
    batch.forEach((r) => {
      values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`);
      params.push(r.usn, r.placement_drive_id, r.is_eligible, r.registration_status, r.approved_status);
      idx += 5;
    });
    const res = await client.query(
      `INSERT INTO student_placement_process (usn, placement_drive_id, is_eligible, registration_status, approved_status)
       VALUES ${values.join(', ')}
       ON CONFLICT DO NOTHING`,
      params
    );
    inserted += res.rowCount || 0;
  }

  await client.query(
    `UPDATE placements_drives SET number_of_registrations = (
       SELECT COUNT(*)::int FROM student_placement_process WHERE placement_drive_id = $1
     ), updated_at = NOW() WHERE id = $1`,
    [driveId]
  );

  const { rows: countRows } = await client.query(
    `SELECT COUNT(*)::int AS cnt FROM student_placement_process WHERE placement_drive_id = $1`,
    [driveId]
  );
  return countRows[0].cnt;
}

async function createJobOffers(client, drive, companyName, usns) {
  const selected = usns.slice(0, OFFERS_PER_COMPLETED_DRIVE);
  let created = 0;

  for (let i = 0; i < selected.length; i++) {
    const usn = selected[i];
    const designation = DESIGNATIONS[i % DESIGNATIONS.length];
    const cmin = 10 + (i % 5);
    const cmax = cmin + 4 + (i % 3);
    const status = i % 4 === 0 ? 'Pending' : 'Accepted';

    const existing = await client.query(
      `SELECT p.id FROM placement p
       WHERE p.student_id = $1 AND p.company_id = $2
         AND p.remarks = $3`,
      [usn, drive.company_id, `(aetheriq-drive-${drive.id})`]
    );
    if (existing.rows.length) continue;

    const pl = await client.query(
      `INSERT INTO placement (
         student_id, company_id, designation, offer_letter_status,
         ctc_min_lpa, ctc_max_lpa, type_of_hiring, academic_year, remarks, job_description
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        usn,
        drive.company_id,
        designation,
        status,
        cmin,
        cmax,
        'Full Time',
        ACADEMIC_YEAR,
        `(aetheriq-drive-${drive.id})`,
        drive.job_description || null,
      ]
    );

    await client.query(
      `INSERT INTO offers (student_id, company_id, placement_id, job_type, academic_year, remarks, is_accepted)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        usn,
        drive.company_id,
        pl.rows[0].id,
        'full time',
        ACADEMIC_YEAR,
        `(aetheriq-drive-${drive.id})`,
        status === 'Accepted',
      ]
    );
    created++;
  }
  return created;
}

async function main() {
  const now = new Date();
  const client = await pool.connect();

  try {
    const { rows: companies } = await client.query(
      `SELECT id, company_name FROM companies
       WHERE company_name ILIKE $1
       ORDER BY id LIMIT 1`,
      [`%${COMPANY_NAME_MATCH}%`]
    );

    if (!companies.length) {
      console.error(`Company "${COMPANY_NAME_MATCH}" not found. Create it first or check the name.`);
      process.exit(1);
    }

    const company = companies[0];
    console.log(`Company: ${company.company_name} (id=${company.id})\n`);

    const students = await loadStudents(client, REGISTRATIONS_PER_DRIVE + 20);
    if (students.length < REGISTRATIONS_PER_DRIVE) {
      console.error(`Need at least ${REGISTRATIONS_PER_DRIVE} students; found ${students.length}.`);
      process.exit(1);
    }
    console.log(`Student pool: ${students.length} USNs\n`);

    const driveSpecs = [
      {
        label: 'Upcoming',
        placement_status: 'Scheduled',
        job_type: 'Full Time',
        job_location: 'Bangalore',
        job_description: 'Aetheriq campus drive — upcoming batch for SDE and full-stack roles.',
        openings: 40,
        event_datetime: addDays(now, 21),
        last_date_to_registration: addDays(now, 14),
        company_remarks: 'Aetheriq upcoming drive (seed)',
        ctc_structure: { min_lpa: 12, max_lpa: 18 },
        seedOffers: false,
      },
      {
        label: 'Completed 1',
        placement_status: 'Completed',
        job_type: 'Full Time',
        job_location: 'Hyderabad',
        job_description: 'Aetheriq completed drive — software engineering placements.',
        openings: 35,
        event_datetime: addDays(now, -45),
        last_date_to_registration: addDays(now, -60),
        company_remarks: 'Aetheriq completed drive 1 (seed)',
        ctc_structure: { min_lpa: 11, max_lpa: 17 },
        seedOffers: true,
      },
      {
        label: 'Completed 2',
        placement_status: 'Completed',
        job_type: 'Internship + Full Time',
        job_location: 'Remote',
        job_description: 'Aetheriq completed drive — internship cum full-time track.',
        openings: 30,
        event_datetime: addDays(now, -90),
        last_date_to_registration: addDays(now, -105),
        company_remarks: 'Aetheriq completed drive 2 (seed)',
        ctc_structure: { min_lpa: 9, max_lpa: 14 },
        seedOffers: true,
      },
    ];

    await client.query('BEGIN');

    for (const spec of driveSpecs) {
      const drive = await insertDrive(client, company.id, spec);
      const regUsns = students.slice(0, REGISTRATIONS_PER_DRIVE);
      const regCount = await registerStudents(client, drive.id, regUsns);

      let offersCreated = 0;
      if (spec.seedOffers) {
        offersCreated = await createJobOffers(client, drive, company.company_name, regUsns);
      }

      console.log(`✓ ${spec.label}: drive id=${drive.id}`);
      console.log(`  Status: ${spec.placement_status}`);
      console.log(`  Registrations: ${regCount}`);
      if (spec.seedOffers) console.log(`  Job offers: ${offersCreated}`);
      console.log('');
    }

    await client.query('COMMIT');
    console.log('Done. Refresh the Aetheriq company page to see the new drives.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
