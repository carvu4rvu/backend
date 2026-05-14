/**
 * Seed script: inserts up to 20 students and required lookup data for View All Students.
 * Run from backend: node scripts/seedStudents.js
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');

const N_STUDENTS = 20;

async function seed() {
  console.log('Seeding students and lookup data...\n');

  // 1. Roles (if not exists - upsert by name not supported, so insert and ignore conflict)
  const roles = [
    { name: 'student' },
    { name: 'admin' },
    { name: 'alumni' },
    { name: 'company' },
    { name: 'vc' },
  ];
  const { data: existingRoles } = await supabase.from('roles').select('id', 'name');
  const existingRoleNamesLower = new Set((existingRoles || []).map((r) => String(r.name || '').toLowerCase()));
  const rolesToInsert = roles.filter((r) => !existingRoleNamesLower.has(String(r.name || '').toLowerCase()));
  if (rolesToInsert.length > 0) {
    const { error: rolesErr } = await supabase.from('roles').insert(rolesToInsert);
    if (rolesErr) console.warn('Roles insert:', rolesErr.message);
    else console.log('Inserted roles:', rolesToInsert.length);
  } else {
    console.log('Roles already present, skipping.');
  }

  // 2. Schools
  const schoolsData = [
    { name: 'School of Engineering', abbreviation: 'SOE' },
    { name: 'School of Computer Science', abbreviation: 'SCS' },
  ];
  const { data: existingSchools } = await supabase.from('schools').select('id', 'name');
  const existingSchoolNames = (existingSchools || []).map((s) => s.name);
  const schoolsToInsert = schoolsData.filter((s) => !existingSchoolNames.includes(s.name));
  let schoolIds = (existingSchools || []).map((s) => ({ name: s.name, id: s.id }));
  if (schoolsToInsert.length > 0) {
    const { data: insertedSchools, error: schoolsErr } = await supabase.from('schools').insert(schoolsToInsert).select('id', 'name');
    if (schoolsErr) {
      console.warn('Schools insert:', schoolsErr.message);
    } else {
      console.log('Inserted schools:', insertedSchools?.length || 0);
      schoolIds = [...schoolIds, ...(insertedSchools || [])];
    }
  } else {
    console.log('Schools already present, skipping.');
  }
  const soeId = schoolIds.find((s) => s.name === 'School of Engineering' || s.abbreviation === 'SOE')?.id || schoolIds[0]?.id;
  const scsId = schoolIds.find((s) => s.name === 'School of Computer Science' || s.abbreviation === 'SCS')?.id || schoolIds[1]?.id || schoolIds[0]?.id;

  // 3. Programs (per school)
  const programsData = [
    { school_id: soeId, name: 'B.Tech Computer Science', graduation_level: 'UG', min_duration_years: 4, max_duration_years: 4 },
    { school_id: soeId, name: 'B.Tech Electronics', graduation_level: 'UG', min_duration_years: 4, max_duration_years: 4 },
    { school_id: scsId, name: 'M.Tech Data Science', graduation_level: 'PG', min_duration_years: 2, max_duration_years: 2 },
  ];
  const { data: existingPrograms } = await supabase.from('programs').select('id', 'name');
  const existingProgramNames = (existingPrograms || []).map((p) => p.name);
  const programsToInsert = programsData.filter((p) => !existingProgramNames.includes(p.name));
  let programIds = (existingPrograms || []).map((p) => ({ name: p.name, id: p.id }));
  if (programsToInsert.length > 0) {
    const { data: insertedPrograms, error: programsErr } = await supabase.from('programs').insert(programsToInsert).select('id', 'name');
    if (programsErr) console.warn('Programs insert:', programsErr.message);
    else {
      console.log('Inserted programs:', insertedPrograms?.length || 0);
      programIds = [...programIds, ...(insertedPrograms || [])];
    }
  } else {
    console.log('Programs already present, skipping.');
  }
  const btechCsId = programIds.find((p) => p.name && p.name.includes('B.Tech Computer Science'))?.id || programIds[0]?.id;
  const btechEceId = programIds.find((p) => p.name && p.name.includes('B.Tech Electronics'))?.id || programIds[1]?.id || programIds[0]?.id;
  const mtechId = programIds.find((p) => p.name && p.name.includes('M.Tech'))?.id || programIds[programIds.length - 1]?.id;

  // 4. Majors (per program)
  const majorsData = [
    { program_id: btechCsId, name: 'Artificial Intelligence' },
    { program_id: btechCsId, name: 'Cyber Security' },
    { program_id: btechEceId, name: 'Embedded Systems' },
  ];
  const { data: existingMajors } = await supabase.from('majors').select('id', 'name');
  const existingMajorNames = (existingMajors || []).map((m) => m.name);
  const majorsToInsert = majorsData.filter((m) => !existingMajorNames.includes(m.name));
  let majorIds = (existingMajors || []).map((m) => ({ name: m.name, id: m.id }));
  if (majorsToInsert.length > 0) {
    const { data: insertedMajors, error: majorsErr } = await supabase.from('majors').insert(majorsToInsert).select('id', 'name');
    if (majorsErr) console.warn('Majors insert:', majorsErr.message);
    else {
      console.log('Inserted majors:', insertedMajors?.length || 0);
      majorIds = [...majorIds, ...(insertedMajors || [])];
    }
  }
  const majorAiId = majorIds.find((m) => m.name === 'Artificial Intelligence')?.id || majorIds[0]?.id;

  // 5. Minors (per school)
  const minorsData = [
    { school_id: soeId, name: 'Minor in Business' },
    { school_id: scsId, name: 'Minor in Mathematics' },
  ];
  const { data: existingMinors } = await supabase.from('minors').select('id', 'name');
  const existingMinorNames = (existingMinors || []).map((m) => m.name);
  const minorsToInsert = minorsData.filter((m) => !existingMinorNames.includes(m.name));
  let minorIds = (existingMinors || []).map((m) => ({ name: m.name, id: m.id }));
  if (minorsToInsert.length > 0) {
    const { data: insertedMinors, error: minorsErr } = await supabase.from('minors').insert(minorsToInsert).select('id', 'name');
    if (minorsErr) console.warn('Minors insert:', minorsErr.message);
    else {
      console.log('Inserted minors:', insertedMinors?.length || 0);
      minorIds = [...minorIds, ...(insertedMinors || [])];
    }
  }
  const minorBizId = minorIds[0]?.id;

  // 6. Specializations (per program)
  const specializationsData = [
    { program_id: btechCsId, name: 'Machine Learning' },
    { program_id: btechCsId, name: 'Cloud Computing' },
  ];
  const { data: existingSpecs } = await supabase.from('specializations').select('id', 'name');
  const existingSpecNames = (existingSpecs || []).map((s) => s.name);
  const specsToInsert = specializationsData.filter((s) => !existingSpecNames.includes(s.name));
  let specIds = (existingSpecs || []).map((s) => ({ name: s.name, id: s.id }));
  if (specsToInsert.length > 0) {
    const { data: insertedSpecs, error: specsErr } = await supabase.from('specializations').insert(specsToInsert).select('id', 'name');
    if (specsErr) console.warn('Specializations insert:', specsErr.message);
    else {
      console.log('Inserted specializations:', insertedSpecs?.length || 0);
      specIds = [...specIds, ...(insertedSpecs || [])];
    }
  }
  const specMlId = specIds[0]?.id;

  // 7. Students (up to N_STUDENTS)
  const { data: existingStudents } = await supabase.from('student_basic_details').select('usn');
  const existingUsns = new Set((existingStudents || []).map((s) => s.usn));

  const firstNames = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Isha', 'Arjun', 'Sneha', 'Karan', 'Divya', 'Rahul', 'Kavya', 'Aditya', 'Neha', 'Siddharth', 'Meera', 'Varun', 'Pooja', 'Nikhil', 'Shreya'];
  const programsForStudents = [btechCsId, btechCsId, btechEceId, btechCsId, mtechId, btechCsId, btechEceId, btechCsId, btechCsId, mtechId, btechCsId, btechEceId, btechCsId, btechCsId, mtechId, btechEceId, btechCsId, btechCsId, btechEceId, mtechId];

  const studentsToInsert = [];
  for (let i = 1; i <= N_STUDENTS; i++) {
    const usn = `STUD${i}_23`;
    if (existingUsns.has(usn)) continue;
    const programId = programsForStudents[i - 1] || btechCsId;
    let schoolId = soeId;
    const { data: prog } = await supabase.from('programs').select('school_id').eq('id', programId).single();
    if (prog?.school_id) schoolId = prog.school_id;
    studentsToInsert.push({
      usn,
      full_name: firstNames[i - 1] + ' Student',
      college_email: `student${i}@rvu.edu.in`,
      school_id: schoolId,
      program_id: programId,
      major_id: i % 3 === 0 ? null : majorAiId,
      minor_id: i % 4 === 0 ? minorBizId : null,
      specialization_id: i % 2 === 0 ? specMlId : null,
      year_of_joining: 2023,
      current_year: Math.min(3, Math.floor((i % 4) + 1)),
      current_semester: Math.min(6, Math.floor((i % 6) + 1)),
      section: ['A', 'B', 'C'][i % 3],
      is_registered: i % 2 === 0,
    });
  }

  if (studentsToInsert.length > 0) {
    const { data: insertedStudents, error: studentsErr } = await supabase.from('student_basic_details').insert(studentsToInsert).select('usn');
    if (studentsErr) {
      console.error('Students insert error:', studentsErr.message);
    } else {
      console.log('Inserted students:', insertedStudents?.length || studentsToInsert.length);
    }
  } else {
    console.log('All students already exist (or no new rows to insert).');
  }

  console.log('\nSeed completed.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
