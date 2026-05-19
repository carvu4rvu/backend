/**
 * Seed internships, trainings, certifications, publications,
 * extra-curricular, and other experiences for one student (no proof images).
 *
 * Usage (from backend/):
 *   node scripts/seedStudentGrowthSections.js
 *   node scripts/seedStudentGrowthSections.js 1RVU23BSC099
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const DEFAULT_USN = '1RVU23BSC099';

async function main() {
  const usn = (process.argv[2] || DEFAULT_USN).trim().toUpperCase();
  const client = await pool.connect();

  try {
    const { rows: students } = await client.query(
      'SELECT usn FROM student_basic_details WHERE usn = $1',
      [usn]
    );
    if (!students.length) {
      console.error(`Student not found: ${usn}`);
      process.exit(1);
    }
    console.log(`Seeding growth sections for ${usn}...`);

    await client.query('BEGIN');

    // Internship
    await client.query('DELETE FROM student_internships WHERE usn = $1', [usn]);
    await client.query(
      `INSERT INTO student_internships (
        usn, job_role, organization, organization_details, duration_months,
        start_date, end_date, location, stipend, skills, description, mentor_name,
        proof_document, academic_year, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, $13, NOW()
      )`,
      [
        usn,
        'Software Development Intern',
        'TechVista Solutions',
        'Product engineering and QA team',
        3,
        '2024-06-01',
        '2024-08-31',
        'Bengaluru',
        15000,
        'JavaScript, React, REST APIs, Git',
        'Developed student portal modules and fixed API integration bugs.',
        'Priya Sharma',
        '2024-25',
      ]
    );

    // Training
    await client.query('DELETE FROM student_trainings WHERE usn = $1', [usn]);
    await client.query(
      `INSERT INTO student_trainings (
        usn, title, institution, training_type, start_date, end_date,
        skills, description, proof_document, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, NULL, NOW()
      )`,
      [
        usn,
        'Full Stack Web Development Bootcamp',
        'RVU Skill Development Cell',
        'Technical Workshop',
        '2024-01-15',
        '2024-04-30',
        'HTML, CSS, JavaScript, Node.js, MongoDB',
        'Completed intensive bootcamp with capstone web application project.',
      ]
    );

    // Certification
    await client.query('DELETE FROM student_certifications WHERE usn = $1', [usn]);
    await client.query(
      `INSERT INTO student_certifications (
        usn, title, organization, certification_type, skills, score,
        issue_date, expiry_date, proof_document, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, NULL, NOW()
      )`,
      [
        usn,
        'Python for Data Science',
        'NPTEL / IIT Madras',
        'Online Course',
        ['Python', 'Pandas', 'Data Analysis'],
        '87%',
        '2024-03-20',
        '2027-03-20',
      ]
    );

    // Publication
    await client.query('DELETE FROM student_publications WHERE usn = $1', [usn]);
    await client.query(
      `INSERT INTO student_publications (
        usn, title, publication_name, publication_type, publication_date,
        author_count, mentor_name, skills, description, evidence_document, link, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, NOW()
      )`,
      [
        usn,
        'IoT-Based Smart Campus Energy Monitoring',
        'RVU Journal of Science & Technology',
        'Conference Paper',
        '2025-02-10',
        3,
        'Dr. Arun Kumar',
        'IoT, Embedded Systems, Energy Analytics',
        'Co-authored paper on low-cost sensor networks for campus power usage tracking.',
        'https://example.org/publications/placeholder',
      ]
    );

    // Extra-curricular
    await client.query('DELETE FROM student_extra_curricular_activities WHERE usn = $1', [usn]);
    await client.query(
      `INSERT INTO student_extra_curricular_activities (
        usn, activity_name, activity_type, role, organization,
        start_date, end_date, achievements, skills, description, proof_document, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NOW()
      )`,
      [
        usn,
        'National Coding Hackathon',
        'Competition',
        'Team Lead',
        'RVU Computer Science Club',
        '2024-09-01',
        '2024-09-03',
        'Top 10 finalist among 120 teams',
        'Problem Solving, Team Leadership, Python',
        'Led a 4-member team to build a prototype scheduling assistant for labs.',
      ]
    );

    // Other experience
    await client.query('DELETE FROM student_other_experiences WHERE usn = $1', [usn]);
    await client.query(
      `INSERT INTO student_other_experiences (
        usn, title, organization, start_date, end_date, location,
        skills, description, proof_document, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, NULL, NOW()
      )`,
      [
        usn,
        'Community STEM Mentor',
        'Teach For India – Local Chapter',
        '2023-11-01',
        '2024-05-31',
        'Mysuru',
        'Teaching, Communication, Mentoring',
        'Volunteered on weekends mentoring high-school students in basic programming.',
      ]
    );

    await client.query('COMMIT');

    const tables = [
      'student_internships',
      'student_trainings',
      'student_certifications',
      'student_publications',
      'student_extra_curricular_activities',
      'student_other_experiences',
    ];
    for (const t of tables) {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM ${t} WHERE usn = $1`, [usn]);
      console.log(`  ${t}: ${rows[0].c} row(s)`);
    }
    console.log('Done. Proof documents left empty — add images in the profile UI when ready.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
