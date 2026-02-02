/**
 * Fill null/empty placement drive fields with sensible defaults.
 * Remarks: 1st time visit, 2nd time visit, RVCE, RVITM, Hackathon, etc.
 * Run from backend: node scripts/fillPlacementDriveFields.js
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');

const COMPANY_REMARKS = [
  '1st time visit',
  '2nd time visit',
  'RVCE pool campus',
  'RVITM pool campus',
  'Hackathon partner',
  'Recurring recruiter',
  'On-campus drive',
  'Pool campus (RVCE + RVITM)',
  'Pre-placement talk scheduled',
  'Technical round focus',
];

const TPO_NAMES = [
  'Mr. Rajesh Kumar',
  'Ms. Sarah Jones',
  'Mr. Anuj Sharma',
  'Ms. Priya V.',
  'Mr. David L.',
  'Ms. Kavitha N.',
  'Mr. Suresh Reddy',
];

const JOB_LOCATIONS = [
  'Bangalore',
  'Hyderabad',
  'Mumbai',
  'Chennai',
  'Pune',
  'Remote',
  'Bangalore / Remote',
  'Multiple locations',
];

const JOB_DESCRIPTIONS = {
  'Full Time': 'Full-time software engineering role. Strong problem-solving and CS fundamentals required. Good growth and learning opportunities.',
  'Internship': 'Summer/winter internship for pre-final year students. Mentorship and hands-on project experience. Conversion opportunity based on performance.',
  'Internship + FTE': 'Internship with potential full-time conversion. Performance-based PPO. Strong technical and communication skills preferred.',
  default: 'Software development role. Candidates with strong fundamentals and willingness to learn are encouraged to apply.',
};

const CTC_DEFAULTS = [
  { min: 10, max: 20, variable: 8, stock: 2, final: 15.5 },
  { min: 18, max: 30, variable: 10, stock: 5, final: 24 },
  { min: 22, max: 35, variable: 12, stock: 8, final: 28 },
  { min: 25, max: 45, variable: 15, stock: 10, final: 35 },
  { min: 15, max: 25, variable: 10, stock: 3, final: 20 },
];

const STIPEND_DEFAULTS = [
  { min: 10000, max: 20000, avg: 15000 },
  { min: 20000, max: 40000, avg: 30000 },
  { min: 15000, max: 25000, avg: 20000 },
  { min: 30000, max: 50000, avg: 40000 },
  { min: 12000, max: 22000, avg: 17000 },
];

function pick(arr, index) {
  return arr[index % arr.length];
}

async function main() {
  console.log('Fetching placement drives and reference data...\n');

  const { data: drives, error: drivesErr } = await supabase
    .from('placements_drives')
    .select('id, company_id, job_type, type_of_hiring, job_location, job_description, eligibility_academics, ctc_structure, stipend_structure, tpo, company_remarks')
    .order('id', { ascending: true });

  if (drivesErr) {
    console.error('Error fetching drives:', drivesErr.message);
    process.exit(1);
  }
  if (!drives?.length) {
    console.log('No placement drives found.');
    process.exit(0);
  }

  const { data: schools } = await supabase.from('schools').select('id, name').order('id');
  const { data: programs } = await supabase.from('programs').select('id, name, school_id').order('school_id').order('id');
  if (!schools?.length || !programs?.length) {
    console.error('Need schools and programs in DB.');
    process.exit(1);
  }

  const defaultSchoolId = schools[0].id;
  const defaultProgramId = programs.find((p) => p.school_id === defaultSchoolId)?.id || programs[0].id;

  let updated = 0;
  for (let i = 0; i < drives.length; i++) {
    const d = drives[i];
    const updates = {};
    const jobType = d.job_type || 'Full Time';

    if (d.company_remarks == null || String(d.company_remarks).trim() === '') {
      updates.company_remarks = pick(COMPANY_REMARKS, i);
    }
    if (d.tpo == null || String(d.tpo).trim() === '') {
      updates.tpo = pick(TPO_NAMES, i);
    }
    if (d.job_location == null || String(d.job_location).trim() === '') {
      updates.job_location = pick(JOB_LOCATIONS, i);
    }
    if (d.job_description == null || String(d.job_description).trim() === '') {
      updates.job_description = JOB_DESCRIPTIONS[jobType] || JOB_DESCRIPTIONS.default;
    }
    if (d.type_of_hiring == null || String(d.type_of_hiring).trim() === '') {
      updates.type_of_hiring = 'On Campus';
    }
    const hasEligibility = d.eligibility_academics && typeof d.eligibility_academics === 'object' && (d.eligibility_academics.school_id != null || d.eligibility_academics.program_id != null);
    if (!hasEligibility) {
      updates.eligibility_academics = { school_id: defaultSchoolId, program_id: defaultProgramId };
    }
    if (d.ctc_structure == null || (typeof d.ctc_structure === 'object' && !d.ctc_structure.min && !d.ctc_structure.max && !d.ctc_structure.final)) {
      updates.ctc_structure = pick(CTC_DEFAULTS, i);
    }
    if ((jobType === 'Internship' || jobType === 'Internship + FTE') && (d.stipend_structure == null || (typeof d.stipend_structure === 'object' && !d.stipend_structure.avg && !d.stipend_structure.min))) {
      updates.stipend_structure = pick(STIPEND_DEFAULTS, i);
    }

    if (Object.keys(updates).length === 0) continue;

    const { error: updateErr } = await supabase
      .from('placements_drives')
      .update(updates)
      .eq('id', d.id);

    if (updateErr) {
      console.warn('Update failed for drive', d.id, ':', updateErr.message);
      continue;
    }
    updated++;
    console.log('Updated drive', d.id, ':', Object.keys(updates).join(', '));
  }

  console.log('\nDone. Updated', updated, 'of', drives.length, 'placement drives.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
