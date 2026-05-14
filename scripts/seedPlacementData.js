/**
 * Seed script: inserts placement drives only (no students).
 * Creates 5 drives for each status label:
 * ongoing, completed, scheduled, failed.
 * Run from backend: node scripts/seedPlacementData.js
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');

const DRIVE_STATUSES = ['ongoing', 'completed', 'scheduled', 'failed'];
const N_DRIVES_PER_STATUS = 5;

function addDays(d, days) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out.toISOString();
}

function getDatesByStatus(baseDate, status, idx) {
  if (status === 'scheduled') {
    return {
      event_datetime: addDays(baseDate, 7 + idx * 3),
      last_date_to_registration: addDays(baseDate, 3 + idx * 2),
    };
  }

  if (status === 'ongoing') {
    return {
      event_datetime: addDays(baseDate, idx - 2),
      last_date_to_registration: addDays(baseDate, idx - 3),
    };
  }

  if (status === 'completed') {
    return {
      event_datetime: addDays(baseDate, -14 - idx * 2),
      last_date_to_registration: addDays(baseDate, -21 - idx * 2),
    };
  }

  // failed
  return {
    event_datetime: addDays(baseDate, -7 - idx * 2),
    last_date_to_registration: addDays(baseDate, -12 - idx * 2),
  };
}

async function seed() {
  console.log('Seeding drives only: 5 per status (ongoing/completed/scheduled/failed)...\n');

  // 1. Load companies (for drives)
  const { data: companies, error: companiesErr } = await supabase.from('companies').select('id, company_name').limit(20);
  if (companiesErr || !companies?.length) {
    console.error('Need at least one company. Run seedCompanies.js first.', companiesErr?.message);
    process.exit(1);
  }

  // 2. Create drives by status
  const baseDate = new Date();
  const createdByStatus = {
    ongoing: 0,
    completed: 0,
    scheduled: 0,
    failed: 0,
  };

  let createdTotal = 0;
  let companyIdx = 0;

  for (const status of DRIVE_STATUSES) {
    for (let i = 0; i < N_DRIVES_PER_STATUS; i++) {
      const company = companies[companyIdx % companies.length];
      companyIdx += 1;
      const dates = getDatesByStatus(baseDate, status, i);
      const row = {
        company_id: company.id,
        academic_year: '2025-26',
        year: 2026,
        job_type: i % 2 === 0 ? 'Full Time' : 'Internship',
        type_of_hiring: 'campus',
        process_rounds: [],
        number_of_openings: 10 + i * 3,
        number_of_registrations: 0,
        placement_status: status,
        event_datetime: dates.event_datetime,
        last_date_to_registration: dates.last_date_to_registration,
      };

      const { data: drive, error: driveErr } = await supabase
        .from('placements_drives')
        .insert(row)
        .select('id')
        .single();

      if (driveErr) {
        console.warn('Drive insert error for', company.company_name, `[${status}]`, ':', driveErr.message);
        continue;
      }

      createdByStatus[status] += 1;
      createdTotal += 1;
      console.log('Created drive:', drive.id, '-', company.company_name, `[${status}]`);
    }
  }

  if (createdTotal === 0) {
    console.error('No drives created.');
    process.exit(1);
  }

  console.log('\nDrive creation summary:');
  for (const status of DRIVE_STATUSES) {
    console.log(`- ${status}: ${createdByStatus[status]}`);
  }
  console.log(`Total created: ${createdTotal}`);
  console.log('\nSeed completed.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
