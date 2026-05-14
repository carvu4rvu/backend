/**
 * Seed script: inserts sample job offers into placement + offers tables.
 * Run from backend: node scripts/seedJobOffers.js
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');

const ACADEMIC_YEAR = '2024-25';

const SAMPLE_OFFERS = [
  { designation: 'Software Engineer', job_type: 'full time', ctc_min: 12, ctc_max: 18, status: 'Accepted' },
  { designation: 'Data Analyst', job_type: 'full time', ctc_min: 8, ctc_max: 12, status: 'Issued' },
  { designation: 'Product Manager', job_type: 'full time', ctc_min: 15, ctc_max: 22, status: 'Pending' },
  { designation: 'Backend Developer', job_type: 'internship_cum_full_time', ctc_min: 10, ctc_max: 14, status: 'Yet to Receive' },
  { designation: 'Frontend Developer', job_type: 'full time', ctc_min: 9, ctc_max: 13, status: 'Accepted' },
  { designation: 'ML Engineer', job_type: 'full time', ctc_min: 14, ctc_max: 20, status: 'Issued' },
  { designation: 'DevOps Engineer', job_type: 'full time', ctc_min: 11, ctc_max: 16, status: 'Pending' },
  { designation: 'QA Engineer', job_type: 'internship', ctc_min: null, ctc_max: null, status: 'Pending' },
];

async function seed() {
  console.log('Seeding job offers...\n');

  const { data: students, error: studentsErr } = await supabase
    .from('student_basic_details')
    .select('usn')
    .limit(20);
  if (studentsErr || !students?.length) {
    console.error('No students found. Run seedStudents.js first.', studentsErr?.message);
    process.exit(1);
  }
  const usns = students.map((s) => s.usn);
  console.log('Using students:', usns.length);

  const { data: companies, error: companiesErr } = await supabase
    .from('companies')
    .select('id, company_name')
    .limit(15);
  if (companiesErr || !companies?.length) {
    console.error('No companies found. Run seedCompanies.js first.', companiesErr?.message);
    process.exit(1);
  }
  console.log('Using companies:', companies.length);

  let inserted = 0;
  for (let i = 0; i < SAMPLE_OFFERS.length; i++) {
    const sample = SAMPLE_OFFERS[i];
    const usn = usns[i % usns.length];
    const company = companies[i % companies.length];

    const placement = {
      student_id: usn,
      company_id: company.id,
      designation: sample.designation,
      offer_letter_status: sample.status,
      ctc_min_lpa: sample.ctc_min,
      ctc_max_lpa: sample.ctc_max,
      ctc_variable_pay: sample.ctc_min != null ? 1 : null,
      type_of_hiring: sample.job_type,
      academic_year: ACADEMIC_YEAR,
      remarks: i === 0 ? 'Sample seed offer' : null,
    };

    const { data: placementData, error: placementError } = await supabase
      .from('placement')
      .insert(placement)
      .select('id')
      .single();

    if (placementError) {
      console.warn('Placement insert failed for', usn, company.company_name, ':', placementError.message);
      continue;
    }

    const offer = {
      student_id: usn,
      company_id: company.id,
      placement_id: placementData.id,
      job_type: sample.job_type,
      academic_year: ACADEMIC_YEAR,
      remarks: null,
    };
    const { error: offerError } = await supabase.from('offers').insert(offer);
    if (offerError) {
      console.warn('Offers table insert warning:', offerError.message);
    }
    inserted++;
    console.log('Added:', usn, '->', company.company_name, '-', sample.designation, `(${sample.status})`);
  }

  console.log('\nDone. Inserted', inserted, 'job offers.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
