/**
 * Seed script: ensure each student has at least 2 projects with image assets.
 * Run from backend: node scripts/seedProjects.js
 * Requires .env with DATABASE_URL.
 * Run seedStudents.js first so student_basic_details has USNs.
 * Uses: projects, project_assets, project_metrics.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const PROJECTS_PER_STUDENT = 2;
const ASSETS_PER_PROJECT = 2;

const TITLES = [
  'E-Commerce Platform with React & Node',
  'AI Chatbot for Customer Support',
  'Mobile Health Tracking App',
  'Real-Time Collaborative Whiteboard',
  'Smart Home IoT Dashboard',
  'ML-Based Fraud Detection System',
  'Campus Event Management Portal',
  'Blockchain Voting Prototype',
  'Video Streaming Clone with Recommendations',
  'Inventory Management System',
  'Ride-Sharing Backend API',
  'Social Media Analytics Dashboard',
  'Online Learning Platform',
  'Restaurant Ordering & Kitchen Display',
  'Weather Forecast App with Alerts',
  'Expense Tracker with Reports',
  'Job Portal with Matching Algorithm',
  'Fitness Tracker & Workout Planner',
  'E-Library with Recommendation Engine',
  'Parking Slot Finder App',
  'News Aggregator with Personalization',
  'Recipe Finder & Meal Planner',
  'Pet Adoption Platform',
];

const GENRES = ['Web App', 'Mobile App', 'Full Stack', 'ML/AI', 'IoT', 'DevOps', 'API', 'Data Science'];
const TECH_SAMPLES = [
  ['React', 'Node.js', 'MongoDB'],
  ['Python', 'TensorFlow', 'FastAPI'],
  ['Flutter', 'Firebase'],
  ['React', 'Express', 'PostgreSQL'],
  ['Vue.js', 'Django'],
  ['React Native', 'Node.js'],
  ['Java', 'Spring Boot', 'MySQL'],
  ['Next.js', 'Prisma', 'Supabase'],
];

/** Build a reliable direct image URL for seeded project assets. */
function buildImageUrl(usn, projectOrdinal, assetOrdinal) {
  const label = encodeURIComponent(`${usn} P${projectOrdinal} Img${assetOrdinal}`);
  return `https://placehold.co/1280x720/png?text=${label}`;
}

async function seed() {
  console.log(`Seeding projects (ensuring ${PROJECTS_PER_STUDENT} per student)...\n`);

  const studentsRes = await pool.query('SELECT usn FROM student_basic_details ORDER BY usn');
  const students = studentsRes.rows || [];
  if (!students.length) {
    console.error('No students found. Run seedStudents.js first.');
    process.exit(1);
  }

  const usnToUserId = {};
  const userRes = await pool.query('SELECT id, usn FROM user_login WHERE usn IS NOT NULL');
  (userRes.rows || []).forEach((r) => { usnToUserId[r.usn] = r.id; });

  let insertedProjects = 0;
  let insertedAssets = 0;
  let ensuredMetrics = 0;

  for (let i = 0; i < students.length; i++) {
    const usn = students[i].usn;
    const ownerUserId = usnToUserId[usn] || null;

    const existingForStudentRes = await pool.query(
      'SELECT COUNT(*)::int AS count FROM projects WHERE owner_usn = $1',
      [usn]
    );
    const existingCount = existingForStudentRes.rows[0]?.count || 0;
    const needed = Math.max(0, PROJECTS_PER_STUDENT - existingCount);

    for (let j = 0; j < needed; j++) {
      const globalIdx = i * PROJECTS_PER_STUDENT + j;
      const projectOrdinal = existingCount + j + 1;
      const title = TITLES[globalIdx % TITLES.length];
      const genre = GENRES[globalIdx % GENRES.length];
      const tech = TECH_SAMPLES[globalIdx % TECH_SAMPLES.length];

      const projRes = await pool.query(
        `INSERT INTO projects (
          owner_usn, title, short_description, description, category,
          visibility, hosted_url, github_url, mentor_name, tech_stack,
          priority, owner_user_id, project_status
        )
        VALUES (
          $1, $2, $3, $4, $5,
          'PUBLIC', $6, $7, $8, $9,
          $10, $11, 'approved'
        )
        RETURNING id`,
        [
          usn,
          `${title} (${projectOrdinal})`,
          `${title} student implementation for ${genre}.`,
          `This project implements ${title} and demonstrates practical skills in ${tech.join(', ')}.`,
          genre,
          'https://example.com/demo',
          'https://github.com/example/repo',
          'Dr. Smith',
          tech,
          projectOrdinal,
          ownerUserId,
        ]
      );

      const projectId = projRes.rows[0]?.id;
      if (!projectId) continue;
      insertedProjects += 1;

      for (let k = 0; k < ASSETS_PER_PROJECT; k++) {
        const assetRole = k === 0 ? 'COVER' : 'GALLERY';
        const imageUrl = buildImageUrl(usn, projectOrdinal, k + 1);
        await pool.query(
          `INSERT INTO project_assets (project_id, asset_type, asset_role, original_url, position)
           VALUES ($1, 'IMAGE', $2, $3, $4)`,
          [projectId, assetRole, imageUrl, k]
        );
        insertedAssets += 1;
      }

      await pool.query(
        `INSERT INTO project_metrics (project_id, views, likes, favorites, comments, last_updated)
         VALUES ($1, 0, 0, 0, 0, NOW())
         ON CONFLICT (project_id) DO NOTHING`,
        [projectId]
      );
      ensuredMetrics += 1;
    }
  }

  const coverageRes = await pool.query(
    `SELECT COUNT(*)::int AS students_with_two
     FROM (
       SELECT s.usn
       FROM student_basic_details s
       LEFT JOIN projects p ON p.owner_usn = s.usn
       GROUP BY s.usn
       HAVING COUNT(p.id) >= $1
     ) t`,
    [PROJECTS_PER_STUDENT]
  );

  console.log(`Inserted projects: ${insertedProjects}`);
  console.log(`Inserted image assets: ${insertedAssets}`);
  console.log(`Ensured metrics rows: ${ensuredMetrics}`);
  console.log(`Students with >= ${PROJECTS_PER_STUDENT} projects: ${coverageRes.rows[0]?.students_with_two || 0}/${students.length}`);
  console.log('\nSeed completed.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
