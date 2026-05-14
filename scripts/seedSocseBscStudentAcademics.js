/**
 * Seed course-wise + semester summary academics for SoCSE / B.Sc students.
 * Reads year_of_joining, current_semester, and program max_duration per student;
 * replaces existing student_semester_records (+ course rows) for each targeted USN.
 *
 * Usage (from backend/):
 *   node scripts/seedSocseBscStudentAcademics.js              # all B.Sc students at SoCSE
 *   node scripts/seedSocseBscStudentAcademics.js --all      # same
 *   node scripts/seedSocseBscStudentAcademics.js 1RUA22BSC001  # one USN only
 *
 * Requires DATABASE_URL in .env. Templates are synthetic (placeholder marksheet URLs).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const GRADE_POINTS_MAP = {
  O: 10,
  'A+': 9,
  A: 8,
  B: 7,
  C: 6,
  P: 5,
  F: 0,
};

function normalizeGrade(gradeRaw) {
  if (!gradeRaw) return null;
  const g = String(gradeRaw).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(GRADE_POINTS_MAP, g) ? g : null;
}

function computeSgpaFromCourses(courses = []) {
  let totalCredits = 0;
  let weighted = 0;
  for (const c of courses) {
    const credits = Number(c.credits) || 0;
    const gp = Number(c.grade_points);
    if (!credits || Number.isNaN(gp)) continue;
    totalCredits += credits;
    weighted += credits * gp;
  }
  if (!totalCredits) return { sgpa: null, totalCredits: 0, earnedCredits: 0, activeBacklogs: 0 };
  const sgpa = parseFloat((weighted / totalCredits).toFixed(2));
  const earnedCredits = courses.reduce(
    (sum, c) => sum + (normalizeGrade(c.grade) === 'F' ? 0 : Number(c.credits) || 0),
    0,
  );
  const activeBacklogs = courses.reduce(
    (sum, c) => sum + (normalizeGrade(c.grade) === 'F' ? 1 : 0),
    0,
  );
  return { sgpa, totalCredits, earnedCredits, activeBacklogs };
}

async function recomputeCgpaForStudent(client, usn) {
  const { rows } = await client.query(
    `
      SELECT c.credits, c.grade_points
      FROM public.student_course_wise_academics c
      JOIN public.student_semester_records s ON c.semester_record_id = s.id
      WHERE s.usn = $1
    `,
    [usn],
  );
  if (!rows.length) {
    await client.query(`UPDATE public.student_semester_records SET cgpa = NULL WHERE usn = $1`, [usn]);
    return null;
  }
  const { sgpa: cgpa } = computeSgpaFromCourses(rows);
  await client.query(`UPDATE public.student_semester_records SET cgpa = $2 WHERE usn = $1`, [usn, cgpa]);
  return cgpa;
}

function academicYearLabel(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return null;
  return `${y}-${String(y + 1).slice(-2)}`;
}

function semesterAcademicYear(yearOfJoining, semester) {
  const yoj = Number(yearOfJoining);
  const sem = Number(semester);
  if (Number.isNaN(yoj) || Number.isNaN(sem) || sem < 1) return new Date().getFullYear();
  return yoj + Math.floor((sem - 1) / 2);
}

function coursesForBscSemester(sem, targetBracket) {
  // GPA Brackets: 'HIGH' (9+), 'MID' (8-9), 'LOW' (<8)
  const getGrades = () => {
    if (targetBracket === 'HIGH') {
      return ['O', 'O', 'A+', 'O', 'A+']; // Mostly 10s and 9s
    } else if (targetBracket === 'LOW') {
      return ['B', 'B', 'C', 'A', 'B']; // Mostly 7s and 6s
    } else {
      return ['A+', 'A', 'A', 'B', 'A']; // Mostly 8s and 9s
    }
  };
  
  const grades = getGrades();
  const gp = (g) => GRADE_POINTS_MAP[g];

  const templates = {
    1: [
      ['ENG101', 'Technical English', 3],
      ['MAT101', 'Differential Calculus and Algebra', 4],
      ['PHY101', 'Mechanics and Properties of Matter', 4],
      ['CHM101', 'General Chemistry', 3],
      ['CS101', 'Problem Solving and Programming', 4],
    ],
    2: [
      ['ENG102', 'Professional Communication', 3],
      ['MAT102', 'Integral Calculus and Linear Algebra', 4],
      ['PHY102', 'Electricity and Magnetism', 4],
      ['CHM102', 'Environmental Chemistry', 3],
      ['CS102', 'Object Oriented Programming', 4],
    ],
    3: [
      ['MAT201', 'Transforms and Numerical Methods', 4],
      ['CS201', 'Data Structures', 4],
      ['CS202', 'Digital Design', 3],
      ['CS203', 'Discrete Mathematical Structures', 4],
      ['HUM201', 'Indian Constitution and Ethics', 2],
    ],
    4: [
      ['MAT202', 'Probability and Statistics', 4],
      ['CS204', 'Design and Analysis of Algorithms', 4],
      ['CS205', 'Computer Organization and Architecture', 4],
      ['CS206', 'Operating Systems', 4],
      ['HUM202', 'Environmental Studies', 2],
    ],
    5: [
      ['CS301', 'Database Management Systems', 4],
      ['CS302', 'Theory of Computation', 3],
      ['CS303', 'Computer Networks', 4],
      ['CS304', 'Software Engineering', 3],
      ['ELE301', 'Department Elective I', 3],
    ],
    6: [
      ['CS305', 'Compiler Design', 3],
      ['CS306', 'Machine Learning Foundations', 4],
      ['CS307', 'Web Technologies', 3],
      ['CS308', 'Internet of Things', 3],
      ['ELE302', 'Department Elective II', 3],
    ],
    7: [
      ['CS401', 'Distributed Systems', 4],
      ['CS402', 'Information Security', 3],
      ['ELE401', 'Open Elective I', 3],
      ['ELE402', 'Department Elective III', 3],
      ['INT401', 'Mini Project', 4],
    ],
    8: [
      ['CS499', 'Major Project / Dissertation', 10],
      ['ELE403', 'Department Elective IV', 3],
      ['HUM401', 'Professional Ethics and IPR', 2],
    ],
  };

  const rows = templates[sem] || templates[8];
  return rows.map(([code, title, credits], i) => {
    const grade = grades[i % grades.length];
    return {
      course_code: code,
      course_title: title,
      credits,
      grade,
      grade_points: gp(grade),
    };
  });
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return rows.length > 0;
}

async function resolveSocseSchool(client) {
  const { rows: schools } = await client.query(
    `
      SELECT id, name, abbreviation FROM schools
      WHERE abbreviation ILIKE 'SOCSE'
         OR abbreviation ILIKE 'SoCSE'
         OR abbreviation ILIKE '%SCSE%'
         OR lower(name) LIKE '%socse%'
         OR (lower(name) LIKE '%computer%' AND lower(name) LIKE '%science%')
      ORDER BY CASE WHEN abbreviation ILIKE 'SOCSE' THEN 0 WHEN abbreviation ILIKE 'SoCSE' THEN 1 ELSE 2 END, id
      LIMIT 1
    `,
  );
  if (!schools.length) {
    throw new Error(
      'No SOCSE / SoCSE school found. Add it under Placement → Students → Academic (Manage Academic).',
    );
  }
  return schools[0];
}

function isBscProgramName(name) {
  const n = String(name || '').toLowerCase();
  return n.includes('b.sc') || n.includes('bsc') || n.includes('bachelor of science');
}

/**
 * All students at SoCSE whose program name looks like B.Sc (uses their row program_id for duration).
 */
async function listSocseBscStudents(client, schoolId) {
  const { rows } = await client.query(
    `
      SELECT s.usn, s.year_of_joining, s.current_semester, s.school_id, s.program_id, s.major_id,
             p.max_duration_years, p.name AS program_name
      FROM public.student_basic_details s
      INNER JOIN public.programs p ON p.id = s.program_id
      WHERE s.school_id = $1
        AND (
          lower(p.name) LIKE '%b.sc%'
          OR lower(p.name) LIKE '%bsc%'
          OR lower(p.name) LIKE '%bachelor of science%'
        )
      ORDER BY s.usn
    `,
    [schoolId],
  );
  return rows;
}

async function unlockAllSems(client, usn) {
  await client.query(
    `
      INSERT INTO public.student_edit_control (usn)
      VALUES ($1)
      ON CONFLICT (usn) DO NOTHING
    `,
    [usn],
  );
  await client.query(
    `
      UPDATE public.student_edit_control SET
        is_sem1_locked = false, is_sem2_locked = false, is_sem3_locked = false, is_sem4_locked = false,
        is_sem5_locked = false, is_sem6_locked = false, is_sem7_locked = false, is_sem8_locked = false,
        last_updated_at = now()
      WHERE usn = $1
    `,
    [usn],
  );
}

/**
 * @param {object} opts
 * @param {boolean} opts.normalizeCatalog - if true, set school/program/major to canonical SoCSE + first BSc program (single-USN mode)
 */
async function seedOneStudent(client, stu, school, canonicalBscProgram, hasLegacy, { normalizeCatalog, bracket }) {
  const usnArg = String(stu.usn).trim().toUpperCase();
  const program = normalizeCatalog ? canonicalBscProgram : { id: stu.program_id, name: stu.program_name };
  const maxSem = Math.min(8, Math.max(2, (Number(stu.max_duration_years) || 3) * 2));
  let currentSem = Number(stu.current_semester);
  if (!Number.isFinite(currentSem) || currentSem < 1) currentSem = 1;
  if (currentSem > maxSem) currentSem = maxSem;
  const semestersToSeed = Math.max(1, Math.min(currentSem, maxSem));
  const yoj = Number(stu.year_of_joining) || 2022;

  if (normalizeCatalog) {
    const { rows: majorPick } = await client.query(
      `SELECT id FROM public.majors WHERE program_id = $1 ORDER BY id LIMIT 1`,
      [program.id],
    );
    const majorId = majorPick[0]?.id ?? stu.major_id;
    await client.query(
      `
        UPDATE public.student_basic_details
        SET school_id = $2, program_id = $3, major_id = COALESCE(major_id, $4)
        WHERE usn = $1
      `,
      [usnArg, school.id, program.id, majorId],
    );
  } else if (!stu.major_id) {
    const { rows: majorPick } = await client.query(
      `SELECT id FROM public.majors WHERE program_id = $1 ORDER BY id LIMIT 1`,
      [stu.program_id],
    );
    if (majorPick[0]) {
      await client.query(
        `UPDATE public.student_basic_details SET major_id = $2 WHERE usn = $1 AND major_id IS NULL`,
        [usnArg, majorPick[0].id],
      );
    }
  }

  await client.query(
    `DELETE FROM public.student_course_wise_academics WHERE semester_record_id IN (
       SELECT id FROM public.student_semester_records WHERE usn = $1
     )`,
    [usnArg],
  );
  await client.query(`DELETE FROM public.student_semester_records WHERE usn = $1`, [usnArg]);
  if (hasLegacy) {
    await client.query(`DELETE FROM public.student_semester_academics WHERE usn = $1`, [usnArg]);
  }

  for (let sem = 1; sem <= semestersToSeed; sem += 1) {
    const academicYear = semesterAcademicYear(yoj, sem);
    const courses = coursesForBscSemester(sem, bracket);
    const { sgpa, totalCredits, earnedCredits, activeBacklogs } = computeSgpaFromCourses(courses);
    const resultFile = 'https://hzxmkctnqshstphubfyu.supabase.co/storage/v1/object/public/student-assets/academics/1RVU23BSC099/094b5630e0395390.b620f4e570887e81.jpg';

    const {
      rows: [ins],
    } = await client.query(
      `
        INSERT INTO public.student_semester_records (
          usn, academic_year, semester, result_file, sgpa, cgpa,
          total_credits, earned_credits, active_backlogs, cleared_backlogs
        )
        VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, 0)
        RETURNING id
      `,
      [usnArg, academicYear, sem, resultFile, sgpa, totalCredits, earnedCredits, activeBacklogs],
    );

    const semId = ins.id;
    for (const c of courses) {
      const isFailed = normalizeGrade(c.grade) === 'F';
      await client.query(
        `
          INSERT INTO public.student_course_wise_academics (
            semester_record_id, course_code, course_title, credits, grade, grade_points,
            attempt_number, is_backlog, is_cleared
          )
          VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)
        `,
        [
          semId,
          c.course_code,
          c.course_title,
          c.credits,
          c.grade,
          c.grade_points,
          isFailed,
          !isFailed,
        ],
      );
    }

    if (hasLegacy) {
      const ayLabel = academicYearLabel(academicYear);
      await client.query(
        `
          INSERT INTO public.student_semester_academics (
            usn, academic_year, semester, result_in_sgpa, live_backlogs, closed_backlogs,
            provisional_result_upload_links
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [usnArg, ayLabel, sem, sgpa, activeBacklogs, 0, resultFile],
      );
    }
  }

  const cgpa = await recomputeCgpaForStudent(client, usnArg);
  await unlockAllSems(client, usnArg);

  return {
    usn: usnArg,
    semestersToSeed,
    maxSem,
    yoj,
    cgpa,
    programName: program.name,
  };
}

async function resolveCanonicalBscProgram(client, schoolId) {
  const { rows: programs } = await client.query(
    `
      SELECT id, name FROM programs
      WHERE school_id = $1
        AND (
          lower(name) LIKE '%b.sc%'
          OR lower(name) LIKE '%bsc%'
          OR lower(name) LIKE '%bachelor of science%'
        )
      ORDER BY CASE WHEN lower(name) LIKE '%bsc h%' OR name = 'BSc H' THEN 0 ELSE 1 END, length(name), id
      LIMIT 1
    `,
    [schoolId],
  );
  if (!programs.length) {
    throw new Error(`No B.Sc program under school id ${schoolId}. Add program in Manage Academic.`);
  }
  return programs[0];
}

async function main() {
  const rawArg = process.argv[2];
  const modeAll = !rawArg || rawArg === '--all' || rawArg.toLowerCase() === 'all';
  const usnSingle = modeAll ? null : String(rawArg).trim().toUpperCase();

  const client = await pool.connect();
  let hasLegacy = false;

  try {
    const school = await resolveSocseSchool(client);
    const canonicalBscProgram = await resolveCanonicalBscProgram(client, school.id);
    hasLegacy = await tableExists(client, 'student_semester_academics');

    let targets = [];
    if (modeAll) {
      targets = await listSocseBscStudents(client, school.id);
      console.log(
        `SoCSE: ${school.name} (${school.abbreviation}) — seeding academics for ${targets.length} B.Sc student(s).`,
      );
      if (targets.length === 0) {
        console.log('No rows in student_basic_details with school_id = SoCSE and a B.Sc program. Nothing to do.');
        return;
      }
    } else {
      const { rows } = await client.query(
        `
          SELECT s.usn, s.year_of_joining, s.current_semester, s.school_id, s.program_id, s.major_id,
                 p.max_duration_years, p.name AS program_name
          FROM public.student_basic_details s
          LEFT JOIN public.programs p ON p.id = s.program_id
          WHERE s.usn = $1
        `,
        [usnSingle],
      );
      if (!rows.length) throw new Error(`Student ${usnSingle} not found.`);
      const stu = rows[0];
      if (Number(stu.school_id) !== Number(school.id)) {
        console.warn(
          `Warning: ${usnSingle} school_id (${stu.school_id}) is not SoCSE (${school.id}); still seeding with normalizeCatalog.`,
        );
      }
      if (!isBscProgramName(stu.program_name)) {
        console.warn(`Warning: program "${stu.program_name}" may not be B.Sc; proceeding.`);
      }
      targets = [stu];
    }

    const failures = [];
    const total = targets.length;
    
    // Distribute brackets: 25% HIGH, 25% LOW, 50% MID
    const countHigh = Math.floor(total * 0.25);
    const countLow = Math.floor(total * 0.25);
    
    // Shuffle targets to apply brackets randomly
    const shuffledTargets = targets.sort(() => Math.random() - 0.5);

    for (let i = 0; i < shuffledTargets.length; i += 1) {
      const stu = shuffledTargets[i];
      const label = `[${i + 1}/${total}] ${stu.usn}`;
      
      let bracket = 'MID';
      if (i < countHigh) bracket = 'HIGH';
      else if (i < countHigh + countLow) bracket = 'LOW';

      try {
        await client.query('BEGIN');
        const normalizeCatalog = Boolean(usnSingle);
        const summary = await seedOneStudent(client, stu, school, canonicalBscProgram, hasLegacy, {
          normalizeCatalog,
          bracket
        });
        await client.query('COMMIT');
        console.log(
          `${label} (${bracket}): YOJ=${summary.yoj}, sems 1–${summary.semestersToSeed}, CGPA ${summary.cgpa}`,
        );
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        failures.push({ usn: stu.usn, error: e.message || String(e) });
        console.error(`${label} FAILED:`, e.message || e);
      }
    }

    if (failures.length) {
      console.error(`\nCompleted with ${failures.length} failure(s).`);
      process.exitCode = 1;
    } else {
      console.log(modeAll ? `\nAll ${targets.length} student(s) seeded successfully.` : '\nDone.');
    }
  } catch (err) {
    console.error(err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  resolveSocseSchool,
  resolveCanonicalBscProgram,
  listSocseBscStudents,
  coursesForBscSemester,
  seedOneStudent,
};
