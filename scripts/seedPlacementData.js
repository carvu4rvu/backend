/**
 * Seed script: inserts 40 more students (randomly across schools), 4–5 placement drives,
 * and registers ALL students (existing + new) under each of those drives.
 * Run from backend: node scripts/seedPlacementData.js
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');

const N_NEW_STUDENTS = 40;
const N_DRIVES = 5;

const FIRST_NAMES = [
  'Riya', 'Arnav', 'Kriti', 'Vivek', 'Sana', 'Rahul', 'Ishita', 'Adarsh', 'Pragya', 'Kunal',
  'Anjali', 'Rishabh', 'Nidhi', 'Yash', 'Tanvi', 'Abhishek', 'Shruti', 'Vikrant', 'Preeti', 'Rajat',
  'Sneha', 'Manish', 'Kavya', 'Siddharth', 'Aishwarya', 'Rohit', 'Divya', 'Akash', 'Neha', 'Pranav',
  'Sonal', 'Gaurav', 'Pooja', 'Nitin', 'Ritu', 'Ankit', 'Megha', 'Vishal', 'Komal', 'Rahul'
];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function addDays(d, days) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out.toISOString();
}

async function seed() {
  console.log('Seeding 40 students, 4–5 drives, and registering all students to those drives...\n');

  // 1. Load schools and programs
  const { data: schools, error: schoolsErr } = await supabase.from('schools').select('id, name');
  if (schoolsErr || !schools?.length) {
    console.error('Need at least one school. Run seedStudents.js first or add schools.', schoolsErr?.message);
    process.exit(1);
  }
  const { data: programs, error: programsErr } = await supabase.from('programs').select('id, name, school_id');
  if (programsErr || !programs?.length) {
    console.error('Need at least one program. Run seedStudents.js first.', programsErr?.message);
    process.exit(1);
  }

  // 2. Load companies (for drives)
  const { data: companies, error: companiesErr } = await supabase.from('companies').select('id, company_name').limit(20);
  if (companiesErr || !companies?.length) {
    console.error('Need at least one company. Run seedCompanies.js first.', companiesErr?.message);
    process.exit(1);
  }

  // 3. Existing students (USNs) to avoid duplicate
  const { data: existingStudents } = await supabase.from('student_basic_details').select('usn');
  const existingUsns = new Set((existingStudents || []).map((s) => s.usn));

  // 4. Insert 40 new students (STUD21_23 .. STUD60_23), spread across schools/programs
  const studentsToInsert = [];
  for (let i = 1; i <= N_NEW_STUDENTS; i++) {
    const usn = `STUD${20 + i}_23`;
    if (existingUsns.has(usn)) continue;
    const program = randomChoice(programs);
    studentsToInsert.push({
      usn,
      full_name: (FIRST_NAMES[i - 1] || `Student${20 + i}`) + ' Student',
      college_email: `student${20 + i}@rvu.edu.in`,
      school_id: program.school_id,
      program_id: program.id,
      year_of_joining: 2023,
      current_year: Math.min(4, Math.floor((i % 4) + 1)),
      current_semester: Math.min(8, Math.floor((i % 8) + 1)),
      section: ['A', 'B', 'C'][i % 3],
      is_registered: i % 2 === 0,
      is_active: true,
    });
  }

  if (studentsToInsert.length > 0) {
    const { data: inserted, error: insErr } = await supabase
      .from('student_basic_details')
      .insert(studentsToInsert)
      .select('usn');
    if (insErr) {
      console.error('Students insert error:', insErr.message);
    } else {
      console.log('Inserted students:', inserted?.length || studentsToInsert.length);
      inserted?.forEach((s) => existingUsns.add(s.usn));
    }
  } else {
    console.log('No new students to insert (USNs STUD21_23..STUD60_23 may already exist).');
  }

  // 5. All student USNs (existing + newly inserted)
  const { data: allStudents } = await supabase.from('student_basic_details').select('usn');
  const allUsns = (allStudents || []).map((s) => s.usn);
  if (allUsns.length === 0) {
    console.error('No students in DB. Aborting.');
    process.exit(1);
  }
  console.log('Total students in DB:', allUsns.length);

  // 6. Create 4–5 placement drives
  const baseDate = new Date();
  // Process rounds are configured per-drive by admin; no dummy rounds seeded
  const drivePayloads = [
    { job_type: 'Full Time', process_rounds: [], openings: 15 },
    { job_type: 'Internship', process_rounds: [], openings: 20 },
    { job_type: 'Full Time', process_rounds: [], openings: 10 },
    { job_type: 'Internship', process_rounds: [], openings: 25 },
    { job_type: 'Full Time', process_rounds: [], openings: 12 },
  ].slice(0, N_DRIVES);

  const driveIds = [];
  for (let d = 0; d < drivePayloads.length; d++) {
    const company = companies[d % companies.length];
    const payload = drivePayloads[d];
    const eventDate = addDays(baseDate, 14 + d * 7);
    const row = {
      company_id: company.id,
      academic_year: '2024-25',
      year: 2025,
      job_type: payload.job_type,
      type_of_hiring: 'campus',
      process_rounds: payload.process_rounds,
      number_of_openings: payload.openings,
      number_of_registrations: 0,
      placement_status: 'Scheduled',
      event_datetime: eventDate,
      last_date_to_registration: addDays(baseDate, 7 + d * 3),
    };
    const { data: drive, error: driveErr } = await supabase
      .from('placements_drives')
      .insert(row)
      .select('id')
      .single();
    if (driveErr) {
      console.warn('Drive insert error for', company.company_name, ':', driveErr.message);
      continue;
    }
    driveIds.push(drive.id);
    console.log('Created drive:', drive.id, '-', company.company_name, payload.job_type);
  }

  if (driveIds.length === 0) {
    console.error('No drives created. Aborting registrations.');
    process.exit(1);
  }
  console.log('Created drives:', driveIds.length);

  // 7. Register every student to every new drive (student_placement_process)
  const existingReg = await supabase
    .from('student_placement_process')
    .select('usn, placement_drive_id')
    .in('placement_drive_id', driveIds);
  const existingSet = new Set(
    (existingReg.data || []).map((r) => `${r.usn}:${r.placement_drive_id}`)
  );

  const processRows = [];
  for (const usn of allUsns) {
    for (const driveId of driveIds) {
      if (existingSet.has(`${usn}:${driveId}`)) continue;
      processRows.push({
        placement_drive_id: driveId,
        usn,
        is_eligible: true,
        registration_status: 'Registered',
      });
    }
  }

  if (processRows.length > 0) {
    const BATCH = 200;
    for (let i = 0; i < processRows.length; i += BATCH) {
      const chunk = processRows.slice(i, i + BATCH);
      const { error: procErr } = await supabase.from('student_placement_process').insert(chunk);
      if (procErr) {
        console.warn('student_placement_process batch error:', procErr.message);
      }
    }
    console.log('Registered all students to drives: inserted', processRows.length, 'rows.');
  } else {
    console.log('All students already registered to these drives.');
  }

  console.log('\nSeed completed.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
