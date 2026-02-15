/**
 * Seed script: adds alumni records for existing students so the Alumni Directory shows more entries.
 * Run from backend: node scripts/seedAlumni.js
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Run seedStudents.js first so student_basic_details has USNs.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');

const ALUMNI_TO_ADD = [
  {
    current_company: 'Microsoft',
    current_designation: 'Senior Software Engineer',
    current_work_location: 'Bangalore',
    personal_email: 'alumni1.personal@gmail.com',
    phone_number: '+91 9876543210',
    linkedin: 'https://linkedin.com/in/sample1',
    graduation_year: 2022,
    institution_name: 'RV University',
  },
  {
    current_company: 'Google',
    current_designation: 'ML Engineer',
    current_work_location: 'Hyderabad',
    personal_email: 'alumni2.personal@gmail.com',
    phone_number: '+91 9876543211',
    linkedin: 'https://linkedin.com/in/sample2',
    graduation_year: 2021,
    institution_name: 'RV University',
  },
  {
    current_company: 'Amazon',
    current_designation: 'SDE 2',
    current_work_location: 'Bengaluru',
    personal_email: 'alumni3.personal@gmail.com',
    phone_number: '+91 9876543212',
    graduation_year: 2022,
    institution_name: 'RV University',
  },
  {
    current_company: 'TCS',
    current_designation: 'Tech Lead',
    current_work_location: 'Chennai',
    personal_email: 'alumni4.personal@gmail.com',
    phone_number: '+91 9876543213',
    linkedin: 'https://linkedin.com/in/sample4',
    graduation_year: 2020,
    institution_name: 'RV University',
  },
  {
    current_company: 'Infosys',
    current_designation: 'Senior System Engineer',
    current_work_location: 'Pune',
    personal_email: 'alumni5.personal@gmail.com',
    phone_number: '+91 9876543214',
    graduation_year: 2021,
    institution_name: 'RV University',
  },
];

async function seed() {
  console.log('Seeding alumni...\n');

  const { data: students, error: studentsErr } = await supabase
    .from('student_basic_details')
    .select('usn, full_name')
    .order('usn', { ascending: true })
    .limit(20);

  if (studentsErr) {
    console.error('Failed to fetch students:', studentsErr.message);
    process.exit(1);
  }
  if (!students || students.length === 0) {
    console.error('No students found. Run seedStudents.js first.');
    process.exit(1);
  }

  const { data: existingAlumni } = await supabase
    .from('alumni')
    .select('student_id');
  const existingUsns = new Set((existingAlumni || []).map((a) => a.student_id).filter(Boolean));

  const toInsert = [];
  for (let i = 0; i < Math.min(ALUMNI_TO_ADD.length, students.length); i++) {
    const stu = students[i];
    if (existingUsns.has(stu.usn)) continue;
    const profile = ALUMNI_TO_ADD[i] || ALUMNI_TO_ADD[0];
    toInsert.push({
      student_id: stu.usn,
      full_name: stu.full_name || `Alumni ${i + 1}`,
      graduation_year: profile.graduation_year ?? 2022,
      institution_name: profile.institution_name ?? null,
      current_company: profile.current_company ?? null,
      current_designation: profile.current_designation ?? null,
      current_work_location: profile.current_work_location ?? null,
      personal_email: profile.personal_email ?? null,
      phone_number: profile.phone_number ?? null,
      linkedin: profile.linkedin ?? null,
      is_verified: true,
    });
    existingUsns.add(stu.usn);
  }

  if (toInsert.length === 0) {
    console.log('All selected students already have alumni records. Nothing to insert.');
    return;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('alumni')
    .insert(toInsert)
    .select('id, student_id, full_name, current_company');

  if (insertErr) {
    console.error('Insert failed:', insertErr.message);
    process.exit(1);
  }
  console.log('Inserted alumni:', inserted?.length || toInsert.length);
  (inserted || []).forEach((a) => {
    console.log(`  - ${a.full_name} (${a.student_id}) @ ${a.current_company || '—'}`);
  });
  console.log('\nAlumni seed done.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
