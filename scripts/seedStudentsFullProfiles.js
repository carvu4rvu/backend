/**
 * Seed script: add 4 students per program with comprehensive profile data.
 *
 * Requirements covered:
 * - 4 students in each program
 * - Batches distributed as 2022, 2023, 2024, 2025 (one each per program)
 * - Foreigner-style names with valid Indian 10-digit phone numbers
 * - Random major/minor/specialization assignment (when available)
 * - Fills student profile sections except projects
 * - Creates/updates login with password 123123
 *
 * Run from backend:
 *   node scripts/seedStudentsFullProfiles.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const LOGIN_PASSWORD = '123123';
const BATCHES = [2022, 2023, 2024, 2025];

const FOREIGN_NAMES = [
  'Liam Carter',
  'Noah Bennett',
  'Ethan Cole',
  'Mason Brooks',
  'Aiden Hayes',
  'Lucas Reed',
  'Oliver Grant',
  'Henry Foster',
  'Elijah Quinn',
  'James Archer',
  'Sofia Martins',
  'Emma Collins',
  'Ava Turner',
  'Mia Harper',
  'Isabella Cruz',
  'Amelia Hayes',
  'Charlotte Young',
  'Camila Ortiz',
  'Evelyn Stone',
  'Zoe Bennett',
  'Nora Walker',
  'Hannah Blake',
  'Chloe Rivera',
  'Leah Morgan',
  'Yuki Nakamura',
  'Kenji Sato',
  'Aria Novak',
  'Mateo Silva',
  'Elena Rossi',
  'Dario Klein',
  'Freya Olsen',
  'Kai Muller',
  'Anya Petrov',
  'Milo Laurent',
  'Lena Fischer',
  'Iris Almeida',
  'Niko Demir',
  'Rina Kato',
  'Theo Marin',
  'Maya Kovac',
];

const CITIES = ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru', 'Pune', 'Hyderabad', 'Chennai'];
const STATES = ['Karnataka', 'Maharashtra', 'Tamil Nadu', 'Telangana'];
const SKILLS = ['Python', 'SQL', 'Power BI', 'React', 'Node.js', 'Java', 'Figma', 'Tableau', 'Excel'];

function pick(arr, idxSeed) {
  if (!arr || arr.length === 0) return null;
  return arr[idxSeed % arr.length];
}

function indianPhone(seed) {
  // Starts with 9 to keep realistic Indian mobile pattern.
  return `9${String(100000000 + (seed % 900000000)).padStart(9, '0')}`;
}

function ymd(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function makeUsn(programId, batch, slot) {
  // Deterministic custom USN-like key, avoids collision with old STUD* seeds.
  return `RVP${String(programId).padStart(2, '0')}${String(batch).slice(-2)}${String(slot).padStart(2, '0')}`;
}

async function getOrCreateStudentRole(client) {
  let role = await client.query(
    `SELECT id FROM roles WHERE lower(name) = 'student' ORDER BY id LIMIT 1`
  );
  if (role.rows.length > 0) return role.rows[0].id;

  await client.query(
    `INSERT INTO roles (name) VALUES ('student')
     ON CONFLICT ((lower(name))) DO NOTHING`
  );
  role = await client.query(
    `SELECT id FROM roles WHERE lower(name) = 'student' ORDER BY id LIMIT 1`
  );
  if (role.rows.length === 0) throw new Error('Unable to resolve student role');
  return role.rows[0].id;
}

async function hasTable(client, tableName) {
  const { rows } = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${tableName}`]);
  return !!rows[0]?.reg;
}

async function seed() {
  console.log('Seeding full student profiles (4 per program)...\n');

  const client = await pool.connect();
  try {
    const { rows: programs } = await client.query(
      `SELECT id, school_id, name, COALESCE(max_duration_years, min_duration_years, 4) AS duration_years
       FROM programs
       ORDER BY id`
    );
    if (!programs.length) {
      throw new Error('No programs found. Please add programs first.');
    }

    const { rows: majors } = await client.query(`SELECT id, program_id, name FROM majors`);
    const { rows: minors } = await client.query(`SELECT id, school_id, name FROM minors`);
    const { rows: specs } = await client.query(`SELECT id, program_id, name FROM specializations`);

    const majorsByProgram = new Map();
    for (const m of majors) {
      const key = Number(m.program_id);
      if (!majorsByProgram.has(key)) majorsByProgram.set(key, []);
      majorsByProgram.get(key).push(m);
    }

    const minorsBySchool = new Map();
    for (const m of minors) {
      const key = Number(m.school_id);
      if (!minorsBySchool.has(key)) minorsBySchool.set(key, []);
      minorsBySchool.get(key).push(m);
    }

    const specsByProgram = new Map();
    for (const s of specs) {
      const key = Number(s.program_id);
      if (!specsByProgram.has(key)) specsByProgram.set(key, []);
      specsByProgram.get(key).push(s);
    }

    const roleId = await getOrCreateStudentRole(client);
    const passwordHash = await bcrypt.hash(LOGIN_PASSWORD, 10);
    const hasLegacySemesterAcademics = await hasTable(client, 'student_semester_academics');
    const hasSemesterRecords = await hasTable(client, 'student_semester_records');
    const hasEditControl = await hasTable(client, 'student_edit_control');

    let insertedStudents = 0;
    let updatedStudents = 0;
    let loginUpserts = 0;
    let sectionRows = 0;
    let nameCursor = 0;

    for (const program of programs) {
      const majorsForProgram = majorsByProgram.get(Number(program.id)) || [];
      const specsForProgram = specsByProgram.get(Number(program.id)) || [];
      const minorsForSchool = minorsBySchool.get(Number(program.school_id)) || [];
      const duration = Math.max(1, Math.min(6, Number(program.duration_years) || 4));

      for (let i = 0; i < BATCHES.length; i += 1) {
        const batch = BATCHES[i];
        const slot = i + 1;
        const usn = makeUsn(program.id, batch, slot);
        const fullName = FOREIGN_NAMES[nameCursor % FOREIGN_NAMES.length];
        nameCursor += 1;
        const localBase = `${fullName.toLowerCase().replace(/[^a-z]/g, '')}${program.id}${batch}`;
        const collegeEmail = `${localBase}@rvu.edu.in`;
        const personalEmail = `${localBase}@gmail.com`;
        const phone = indianPhone(program.id * 1000 + batch + slot);

        const major = majorsForProgram.length ? pick(majorsForProgram, batch + slot) : null;
        const minor = minorsForSchool.length ? pick(minorsForSchool, batch + slot + 7) : null;
        const spec = specsForProgram.length ? pick(specsForProgram, batch + slot + 13) : null;

        const yearsSinceJoin = Math.max(0, 2026 - batch);
        const currentYear = Math.min(duration, Math.max(1, yearsSinceJoin));
        const currentSemester = Math.min(duration * 2, Math.max(1, currentYear * 2));

        await client.query('BEGIN');
        try {
          const basicResult = await client.query(
            `INSERT INTO student_basic_details (
               usn, full_name, college_email, personal_email,
               school_id, program_id, major_id, minor_id, specialization_id,
               year_of_joining, current_year, current_semester, section,
               gender, date_of_birth, phone_country_code, phone_number, is_registered
             ) VALUES (
               $1, $2, $3, $4,
               $5, $6, $7, $8, $9,
               $10, $11, $12, $13,
               $14, $15, '+91', $16, true
             )
             ON CONFLICT (usn) DO UPDATE SET
               full_name = EXCLUDED.full_name,
               college_email = EXCLUDED.college_email,
               personal_email = EXCLUDED.personal_email,
               school_id = EXCLUDED.school_id,
               program_id = EXCLUDED.program_id,
               major_id = EXCLUDED.major_id,
               minor_id = EXCLUDED.minor_id,
               specialization_id = EXCLUDED.specialization_id,
               year_of_joining = EXCLUDED.year_of_joining,
               current_year = EXCLUDED.current_year,
               current_semester = EXCLUDED.current_semester,
               section = EXCLUDED.section,
               gender = EXCLUDED.gender,
               date_of_birth = EXCLUDED.date_of_birth,
               phone_country_code = EXCLUDED.phone_country_code,
               phone_number = EXCLUDED.phone_number,
               is_registered = true
             RETURNING (xmax = 0) AS inserted`,
            [
              usn,
              fullName,
              collegeEmail,
              personalEmail,
              program.school_id,
              program.id,
              major?.id || null,
              minor?.id || null,
              spec?.id || null,
              batch,
              currentYear,
              currentSemester,
              ['A', 'B', 'C', 'D'][i % 4],
              i % 2 === 0 ? 'Male' : 'Female',
              ymd(batch - 18, (i % 12) + 1, ((program.id + i) % 27) + 1),
              phone,
            ]
          );

          if (basicResult.rows[0]?.inserted) insertedStudents += 1;
          else updatedStudents += 1;

          // Login setup (password: 123123)
          await client.query(
            `INSERT INTO user_login (usn, role_id, password_hash, email_id, is_active)
             VALUES ($1, $2, $3, $4, true)
             ON CONFLICT (usn) DO UPDATE SET
               role_id = EXCLUDED.role_id,
               password_hash = EXCLUDED.password_hash,
               email_id = EXCLUDED.email_id,
               is_active = true`,
            [usn, roleId, passwordHash, collegeEmail]
          );
          loginUpserts += 1;

          // Parent details (3 rows)
          await client.query(`DELETE FROM student_parent_details WHERE usn = $1`, [usn]);
          await client.query(
            `INSERT INTO student_parent_details (usn, parent_type, name, occupation, organization, email, phone_country_code, phone_number, updated_at)
             VALUES
             ($1, 'Father', $2, $3, $4, $5, '+91', $6, NOW()),
             ($1, 'Mother', $7, $8, $9, $10, '+91', $11, NOW()),
             ($1, 'Guardian', $12, $13, $14, $15, '+91', $16, NOW())`,
            [
              usn,
              `${fullName.split(' ')[1] || 'Carter'} Senior`,
              'Operations Manager',
              'Global Logistics Pvt Ltd',
              `${localBase}.father@gmail.com`,
              indianPhone(batch + program.id + 100),
              `${fullName.split(' ')[0]} Grace`,
              'Finance Analyst',
              'State Bank',
              `${localBase}.mother@gmail.com`,
              indianPhone(batch + program.id + 200),
              `${fullName.split(' ')[0]} Mentor`,
              'Consultant',
              'Independent',
              `${localBase}.guardian@gmail.com`,
              indianPhone(batch + program.id + 300),
            ]
          );
          sectionRows += 3;

          // Education history (3 rows)
          await client.query(`DELETE FROM student_education_history WHERE usn = $1`, [usn]);
          await client.query(
            `INSERT INTO student_education_history
              (usn, education_level, institute_name, city, board, start_year, end_year, result, result_type, subjects, marksheet_file)
             VALUES
              ($1, '10TH', $2, $3, 'CBSE', $4, $5, '92.4', 'PERCENTAGE', 'Science, Math, English', 'https://files.example.com/marksheets/' || $1 || '/x.pdf'),
              ($1, '12TH', $6, $3, 'CBSE', $7, $8, '90.1', 'PERCENTAGE', 'PCM', 'https://files.example.com/marksheets/' || $1 || '/xii.pdf'),
              ($1, 'DIPLOMA', $9, $3, 'Autonomous', $10, $11, '8.4', 'CGPA', 'Core Engineering', 'https://files.example.com/marksheets/' || $1 || '/diploma.pdf')`,
            [
              usn,
              'St. George International School',
              pick(CITIES, batch + slot),
              batch - 10,
              batch - 8,
              'Westbridge Senior Secondary School',
              batch - 8,
              batch - 6,
              'Metro Technical Institute',
              batch - 6,
              batch - 4,
            ]
          );
          sectionRows += 3;

          // Education gaps
          await client.query(`DELETE FROM student_education_gaps WHERE usn = $1`, [usn]);
          await client.query(
            `INSERT INTO student_education_gaps (usn, gap_start_date, gap_end_date, gap_reason, remarks)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              usn,
              ymd(batch - 5, 1, 1),
              ymd(batch - 5, 6, 30),
              'Focused language preparation and relocation process',
              'Planned academic transition period',
            ]
          );
          sectionRows += 1;

          // Semester academics (legacy table)
          if (hasLegacySemesterAcademics) {
            await client.query(`DELETE FROM student_semester_academics WHERE usn = $1`, [usn]);
            await client.query(
              `INSERT INTO student_semester_academics
                (usn, academic_year, semester, result_in_sgpa, closed_backlogs, live_backlogs, provisional_result_upload_links)
               VALUES
                ($1, $2, 1, 8.2, 0, 0, 'https://files.example.com/results/' || $1 || '/sem1.pdf'),
                ($1, $2, 2, 8.5, 1, 0, 'https://files.example.com/results/' || $1 || '/sem2.pdf')`,
              [usn, `${batch}-${batch + 1}`]
            );
            sectionRows += 2;
          }

          // Semester records (new table) if present
          if (hasSemesterRecords) {
            await client.query(
              `INSERT INTO student_semester_records
                (usn, academic_year, semester, sgpa, cleared_backlogs, active_backlogs, result_file)
               VALUES
                ($1, $2, 1, 8.2, 0, 0, 'https://files.example.com/results/' || $1 || '/sem1.pdf'),
                ($1, $2, 2, 8.5, 1, 0, 'https://files.example.com/results/' || $1 || '/sem2.pdf')
               ON CONFLICT (usn, academic_year, semester) DO UPDATE SET
                sgpa = EXCLUDED.sgpa,
                cleared_backlogs = EXCLUDED.cleared_backlogs,
                active_backlogs = EXCLUDED.active_backlogs,
                result_file = EXCLUDED.result_file`,
              [usn, batch + 1]
            );
          }

          // Internships
          await client.query(`DELETE FROM student_internships WHERE usn = $1`, [usn]);
          await client.query(
            `INSERT INTO student_internships
              (usn, job_role, organization, organization_details, duration_months, start_date, end_date, location, stipend, skills, description, mentor_name, proof_document, academic_year, updated_at)
             VALUES
              ($1, 'Software Intern', 'Nexa Digital', 'Product engineering team', 3, $2, $3, $4, 25000, 'JavaScript, REST APIs', 'Built internal dashboard modules', 'Rahul Menon', 'https://files.example.com/internships/' || $1 || '/offer.pdf', $5, NOW())`,
            [usn, ymd(batch + 1, 5, 1), ymd(batch + 1, 7, 31), pick(CITIES, program.id + 2), `${batch + 1}-${batch + 2}`]
          );
          sectionRows += 1;

          // Trainings
          await client.query(`DELETE FROM student_trainings WHERE usn = $1`, [usn]);
          await client.query(
            `INSERT INTO student_trainings
              (usn, title, institution, training_type, start_date, end_date, skills, description, proof_document, updated_at)
             VALUES
              ($1, 'Data Analytics Bootcamp', 'SkillForge Academy', 'Online', $2, $3, 'SQL, Power BI', 'Completed intensive analytics modules', 'https://files.example.com/trainings/' || $1 || '/certificate.pdf', NOW())`,
            [usn, ymd(batch + 1, 1, 10), ymd(batch + 1, 3, 20)]
          );
          sectionRows += 1;

          // Certifications
          await client.query(`DELETE FROM student_certifications WHERE usn = $1`, [usn]);
          await client.query(
            `INSERT INTO student_certifications
              (usn, title, organization, certification_type, skills, score, issue_date, expiry_date, proof_document, updated_at)
             VALUES
              ($1, 'Cloud Foundations Associate', 'Cloud Council', 'TECHNICAL', ARRAY['Cloud','DevOps'], '874/1000', $2, $3, 'https://files.example.com/certs/' || $1 || '/cloud.pdf', NOW())`,
            [usn, ymd(batch + 2, 2, 15), ymd(batch + 5, 2, 14)]
          );
          sectionRows += 1;

          // Publications
          await client.query(`DELETE FROM student_publications WHERE usn = $1`, [usn]);
          await client.query(
            `INSERT INTO student_publications
              (usn, title, publication_name, publication_type, publication_date, author_count, mentor_name, skills, description, evidence_document, link, updated_at)
             VALUES
              ($1, 'Applied ML for Campus Mobility', 'International Student Journal', 'JOURNAL', $2, 2, 'Dr. Anita Rao', 'ML, Research', 'Co-authored peer-reviewed student publication', 'https://files.example.com/publications/' || $1 || '/paper.pdf', 'https://doi.org/10.1000/' || lower($1), NOW())`,
            [usn, ymd(batch + 2, 9, 21)]
          );
          sectionRows += 1;

          // Extra-curricular
          await client.query(`DELETE FROM student_extra_curricular_activities WHERE usn = $1`, [usn]);
          await client.query(
            `INSERT INTO student_extra_curricular_activities
              (usn, activity_name, activity_type, role, organization, start_date, end_date, achievements, skills, description, proof_document, updated_at)
             VALUES
              ($1, 'Model United Nations', 'Leadership', 'Delegate', 'RVU Debate Club', $2, $3, 'Best Position Paper', 'Public Speaking, Negotiation', 'Represented university in inter-college MUN', 'https://files.example.com/extracurricular/' || $1 || '/mun.pdf', NOW())`,
            [usn, ymd(batch + 1, 8, 1), ymd(batch + 1, 8, 3)]
          );
          sectionRows += 1;

          // Other experiences
          await client.query(`DELETE FROM student_other_experiences WHERE usn = $1`, [usn]);
          await client.query(
            `INSERT INTO student_other_experiences
              (usn, title, organization, start_date, end_date, location, skills, description, proof_document, updated_at)
             VALUES
              ($1, 'Volunteer Coordinator', 'TeachForCommunity', $2, $3, $4, 'Coordination, Teamwork', 'Coordinated weekend STEM mentoring for school students', 'https://files.example.com/other-exp/' || $1 || '/volunteer.pdf', NOW())`,
            [usn, ymd(batch + 1, 11, 5), ymd(batch + 2, 2, 20), pick(CITIES, batch + 5)]
          );
          sectionRows += 1;

          // Career profile + resume
          await client.query(
            `INSERT INTO student_profile_details
              (usn, brief_summary, key_expertise, hobbies_interests, career_objective, future_goals, resume_file, updated_at)
             VALUES
              ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (usn) DO UPDATE SET
              brief_summary = EXCLUDED.brief_summary,
              key_expertise = EXCLUDED.key_expertise,
              hobbies_interests = EXCLUDED.hobbies_interests,
              career_objective = EXCLUDED.career_objective,
              future_goals = EXCLUDED.future_goals,
              resume_file = EXCLUDED.resume_file,
              updated_at = NOW()`,
            [
              usn,
              `${fullName} is a motivated student with strong analytical and communication skills.`,
              pick(SKILLS, batch + program.id),
              'Badminton, photography, travel',
              'Build scalable products with measurable impact.',
              'Pursue advanced product engineering roles.',
              `https://files.example.com/resumes/${usn}.pdf`,
            ]
          );
          sectionRows += 1;

          // Summer immersion
          await client.query(`DELETE FROM student_summer_immersion WHERE usn = $1`, [usn]);
          await client.query(
            `INSERT INTO student_summer_immersion
              (usn, job_role, organization, organization_details, duration_weeks, start_date, end_date, location, stipend, skills, description, mentor_name, proof_document, academic_year, updated_at)
             VALUES
              ($1, 'Immersion Intern', 'Global Skills Initiative', 'Cross-functional immersion', 6, $2, $3, $4, 15000, 'Research, Analysis', 'Completed industry immersion engagement', 'Naveen Rao', 'https://files.example.com/summer-immersion/' || $1 || '/certificate.pdf', $5, NOW())`,
            [usn, ymd(batch + 1, 6, 1), ymd(batch + 1, 7, 15), pick(CITIES, slot + 2), `${batch + 1}-${batch + 2}`]
          );
          sectionRows += 1;

          // Summer internship
          await client.query(`DELETE FROM student_summer_internship WHERE usn = $1`, [usn]);
          await client.query(
            `INSERT INTO student_summer_internship
              (usn, job_role, organization, organization_details, duration_months, start_date, end_date, location, stipend, skills, description, mentor_name, proof_document, academic_year, updated_at)
             VALUES
              ($1, 'Data Intern', 'Insight Grid', 'Business intelligence team', 2, $2, $3, $4, 18000, 'SQL, Tableau', 'Developed reports for operations metrics', 'Megha Kapoor', 'https://files.example.com/summer-internship/' || $1 || '/letter.pdf', $5, NOW())`,
            [usn, ymd(batch + 1, 6, 10), ymd(batch + 1, 8, 10), pick(CITIES, program.id + 9), `${batch + 1}-${batch + 2}`]
          );
          sectionRows += 1;

          // Capstone (this environment uses internship-summary schema)
          await client.query(`DELETE FROM capstone WHERE usn = $1`, [usn]);
          await client.query(
            `INSERT INTO capstone
              (usn, company_name, internship_duration_months, designation, offer_letter_status, internship_stipend_min, internship_stipend_max, description, academic_year, remarks, updated_at)
             VALUES
              ($1, 'Aether Labs', 6, 'Product Engineering Intern', 'Received', 30000, 45000, 'Final-year internship summary for capstone records.', $2, 'Converted to PPO shortlist', NOW())`,
            [usn, `${batch + 2}-${batch + 3}`]
          );
          sectionRows += 1;

          // Student edit control (if present)
          if (hasEditControl) {
            await client.query(
              `INSERT INTO student_edit_control (usn)
               VALUES ($1)
               ON CONFLICT (usn) DO NOTHING`,
              [usn]
            );
          }

          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
      }
    }

    // Quick verification
    const { rows: verifyRows } = await client.query(
      `SELECT p.id AS program_id, p.name AS program_name, COUNT(s.usn)::int AS student_count
       FROM programs p
       LEFT JOIN student_basic_details s
         ON s.program_id = p.id
         AND s.usn LIKE 'RVP%'
       GROUP BY p.id, p.name
       ORDER BY p.id`
    );

    console.log('Seed complete.\n');
    console.log(`Inserted students: ${insertedStudents}`);
    console.log(`Updated existing students: ${updatedStudents}`);
    console.log(`Login upserts: ${loginUpserts}`);
    console.log(`Profile section rows inserted/updated: ${sectionRows}`);
    console.log('\nPer-program seeded student counts (USN prefix RVP):');
    verifyRows.forEach((r) => {
      console.log(`- [${r.program_id}] ${r.program_name}: ${r.student_count}`);
    });
    console.log(`\nDefault login password for these students: ${LOGIN_PASSWORD}`);
  } catch (err) {
    console.error('Seed failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
