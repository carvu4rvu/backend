/**
 * Seed script: insert academic master data.
 * - 5 schools
 * - 2 programs under each school
 * - 2 minors under each school
 * - 2 specializations under each program
 *
 * Run from backend:
 *   node scripts/seedAcademicCatalog.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');

const ACADEMIC_BLUEPRINT = [
  {
    school: { name: 'School of Engineering and Technology', abbreviation: 'SOET' },
    programs: [
      {
        name: 'B.Tech Mechanical Engineering',
        graduation_level: 'UG',
        min_duration_years: 4,
        max_duration_years: 4,
        specializations: ['Thermal Systems', 'Smart Manufacturing'],
      },
      {
        name: 'B.Tech Civil Engineering',
        graduation_level: 'UG',
        min_duration_years: 4,
        max_duration_years: 4,
        specializations: ['Structural Engineering', 'Sustainable Infrastructure'],
      },
    ],
    minors: ['Minor in Robotics Basics', 'Minor in Energy Systems'],
  },
  {
    school: { name: 'School of Computer Science and IT', abbreviation: 'SCSIT' },
    programs: [
      {
        name: 'B.Tech Computer Science and Engineering',
        graduation_level: 'UG',
        min_duration_years: 4,
        max_duration_years: 4,
        specializations: ['Artificial Intelligence', 'Cloud Native Engineering'],
      },
      {
        name: 'BCA Data Science',
        graduation_level: 'UG',
        min_duration_years: 3,
        max_duration_years: 3,
        specializations: ['Applied Machine Learning', 'Business Analytics'],
      },
    ],
    minors: ['Minor in Full Stack Development', 'Minor in Cybersecurity Foundations'],
  },
  {
    school: { name: 'School of Management and Commerce', abbreviation: 'SMC' },
    programs: [
      {
        name: 'BBA',
        graduation_level: 'UG',
        min_duration_years: 3,
        max_duration_years: 3,
        specializations: ['Marketing Analytics', 'Entrepreneurship'],
      },
      {
        name: 'B.Com Professional',
        graduation_level: 'UG',
        min_duration_years: 3,
        max_duration_years: 3,
        specializations: ['Financial Markets', 'Taxation and Compliance'],
      },
    ],
    minors: ['Minor in Digital Marketing', 'Minor in Financial Modeling'],
  },
  {
    school: { name: 'School of Sciences', abbreviation: 'SOS' },
    programs: [
      {
        name: 'B.Sc Physics',
        graduation_level: 'UG',
        min_duration_years: 3,
        max_duration_years: 3,
        specializations: ['Quantum Applications', 'Computational Physics'],
      },
      {
        name: 'B.Sc Mathematics',
        graduation_level: 'UG',
        min_duration_years: 3,
        max_duration_years: 3,
        specializations: ['Applied Statistics', 'Financial Mathematics'],
      },
    ],
    minors: ['Minor in Data Visualization', 'Minor in Scientific Computing'],
  },
  {
    school: { name: 'School of Design and Humanities', abbreviation: 'SDH' },
    programs: [
      {
        name: 'BA Psychology',
        graduation_level: 'UG',
        min_duration_years: 3,
        max_duration_years: 3,
        specializations: ['Counseling Psychology', 'Organizational Behavior'],
      },
      {
        name: 'B.Des Communication Design',
        graduation_level: 'UG',
        min_duration_years: 4,
        max_duration_years: 4,
        specializations: ['Interaction Design', 'Visual Branding'],
      },
    ],
    minors: ['Minor in Content Strategy', 'Minor in User Experience Research'],
  },
];

function keyByName(name) {
  return String(name || '').trim().toLowerCase();
}

function schoolProgramKey(schoolId, name) {
  return `${schoolId}|${keyByName(name)}`;
}

async function seedAcademicCatalog() {
  console.log('Seeding academic catalog (schools/programs/minors/specializations)...\n');

  const counts = {
    schoolsInserted: 0,
    programsInserted: 0,
    minorsInserted: 0,
    specializationsInserted: 0,
  };

  // 1) Ensure schools
  const { data: existingSchools, error: schoolsFetchErr } = await supabase
    .from('schools')
    .select('id, name, abbreviation');
  if (schoolsFetchErr) throw schoolsFetchErr;

  const schoolByName = new Map((existingSchools || []).map((s) => [keyByName(s.name), s]));
  const schoolsToInsert = [];
  for (const item of ACADEMIC_BLUEPRINT) {
    if (!schoolByName.has(keyByName(item.school.name))) {
      schoolsToInsert.push(item.school);
    }
  }

  if (schoolsToInsert.length > 0) {
    const { data: insertedSchools, error: schoolInsertErr } = await supabase
      .from('schools')
      .insert(schoolsToInsert)
      .select('id, name, abbreviation');
    if (schoolInsertErr) throw schoolInsertErr;
    counts.schoolsInserted = insertedSchools?.length || 0;
    for (const s of insertedSchools || []) {
      schoolByName.set(keyByName(s.name), s);
    }
  }

  // 2) Ensure programs (2 per school from blueprint)
  const { data: existingPrograms, error: programsFetchErr } = await supabase
    .from('programs')
    .select('id, school_id, name');
  if (programsFetchErr) throw programsFetchErr;

  const existingProgramKeys = new Set(
    (existingPrograms || []).map((p) => schoolProgramKey(p.school_id, p.name))
  );
  const programRows = [];
  for (const item of ACADEMIC_BLUEPRINT) {
    const school = schoolByName.get(keyByName(item.school.name));
    if (!school?.id) continue;
    for (const program of item.programs) {
      const k = schoolProgramKey(school.id, program.name);
      if (existingProgramKeys.has(k)) continue;
      programRows.push({
        school_id: school.id,
        name: program.name,
        graduation_level: program.graduation_level,
        min_duration_years: program.min_duration_years,
        max_duration_years: program.max_duration_years,
      });
      existingProgramKeys.add(k);
    }
  }

  if (programRows.length > 0) {
    const { data: insertedPrograms, error: programInsertErr } = await supabase
      .from('programs')
      .insert(programRows)
      .select('id, school_id, name');
    if (programInsertErr) throw programInsertErr;
    counts.programsInserted = insertedPrograms?.length || 0;
  }

  // Reload program map for specialization linking
  const { data: allPrograms, error: allProgramsErr } = await supabase
    .from('programs')
    .select('id, school_id, name');
  if (allProgramsErr) throw allProgramsErr;
  const programIdBySchoolAndName = new Map(
    (allPrograms || []).map((p) => [schoolProgramKey(p.school_id, p.name), p.id])
  );

  // 3) Ensure minors (2 per school from blueprint)
  const { data: existingMinors, error: minorsFetchErr } = await supabase
    .from('minors')
    .select('id, school_id, name');
  if (minorsFetchErr) throw minorsFetchErr;
  const existingMinorKeys = new Set(
    (existingMinors || []).map((m) => schoolProgramKey(m.school_id, m.name))
  );

  const minorRows = [];
  for (const item of ACADEMIC_BLUEPRINT) {
    const school = schoolByName.get(keyByName(item.school.name));
    if (!school?.id) continue;
    for (const minorName of item.minors) {
      const k = schoolProgramKey(school.id, minorName);
      if (existingMinorKeys.has(k)) continue;
      minorRows.push({ school_id: school.id, name: minorName });
      existingMinorKeys.add(k);
    }
  }

  if (minorRows.length > 0) {
    const { data: insertedMinors, error: minorInsertErr } = await supabase
      .from('minors')
      .insert(minorRows)
      .select('id');
    if (minorInsertErr) throw minorInsertErr;
    counts.minorsInserted = insertedMinors?.length || 0;
  }

  // 4) Ensure specializations (2 per program from blueprint)
  const { data: existingSpecs, error: specsFetchErr } = await supabase
    .from('specializations')
    .select('id, program_id, name');
  if (specsFetchErr) throw specsFetchErr;
  const existingSpecKeys = new Set(
    (existingSpecs || []).map((s) => `${s.program_id}|${keyByName(s.name)}`)
  );

  const specRows = [];
  for (const item of ACADEMIC_BLUEPRINT) {
    const school = schoolByName.get(keyByName(item.school.name));
    if (!school?.id) continue;
    for (const program of item.programs) {
      const programId = programIdBySchoolAndName.get(schoolProgramKey(school.id, program.name));
      if (!programId) continue;
      for (const specName of program.specializations) {
        const specKey = `${programId}|${keyByName(specName)}`;
        if (existingSpecKeys.has(specKey)) continue;
        specRows.push({ program_id: programId, name: specName });
        existingSpecKeys.add(specKey);
      }
    }
  }

  if (specRows.length > 0) {
    const { data: insertedSpecs, error: specInsertErr } = await supabase
      .from('specializations')
      .insert(specRows)
      .select('id');
    if (specInsertErr) throw specInsertErr;
    counts.specializationsInserted = insertedSpecs?.length || 0;
  }

  console.log('Done.\n');
  console.log(`Schools inserted: ${counts.schoolsInserted}`);
  console.log(`Programs inserted: ${counts.programsInserted}`);
  console.log(`Minors inserted: ${counts.minorsInserted}`);
  console.log(`Specializations inserted: ${counts.specializationsInserted}`);
}

seedAcademicCatalog().catch((err) => {
  console.error('Seed failed:', err.message || err);
  process.exit(1);
});
