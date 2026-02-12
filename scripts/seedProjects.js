/**
 * Seed script: inserts at least 20 projects into projects table with project_assets.
 * Run from backend: node scripts/seedProjects.js
 * Requires .env with DATABASE_URL (and optionally SUPABASE_URL for storage URLs).
 * Run seedStudents.js first so student_basic_details has USNs.
 * Uses: projects, project_assets, project_metrics, project_ratings.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

// 4 image paths (reused for all seed projects - each project gets 4 GALLERY assets)
const PROJECT_SNAP_PATHS = [
  'projects/STUD1_23/1769681280716_spidey.jpg',
  'projects/STUD1_23/1769681721045_Screenshot_2026_01_29_123051.png',
  'projects/STUD1_23/1769681726436_Screenshot_2026_01_15_224459.png',
  'projects/STUD1_23/1769681736055_Screenshot_2026_01_18_124229.png',
];

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

/** Build storage URL from path (Supabase storage or relative) */
function toStorageUrl(path) {
  const base = process.env.SUPABASE_URL || 'https://example.supabase.co';
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'public';
  return path.startsWith('http') ? path : `${base}/storage/v1/object/public/${bucket}/${path}`;
}

async function seed() {
  console.log('Seeding projects (projects + project_assets)...\n');

  const studentsRes = await pool.query('SELECT usn FROM student_basic_details');
  const students = studentsRes.rows || [];
  if (!students.length) {
    console.error('No students found. Run seedStudents.js first.');
    process.exit(1);
  }

  const usnToUserId = {};
  const userRes = await pool.query('SELECT id, usn FROM user_login WHERE usn IS NOT NULL');
  (userRes.rows || []).forEach((r) => { usnToUserId[r.usn] = r.id; });

  const existingRes = await pool.query('SELECT id FROM projects');
  const existingCount = existingRes.rows?.length ?? 0;

  const usns = students.map((s) => s.usn);
  const n = Math.max(20, usns.length);
  let inserted = 0;

  for (let i = 0; i < n; i++) {
    const usn = usns[i % usns.length];
    const title = TITLES[i % TITLES.length];
    const genre = GENRES[i % GENRES.length];
    const tech = TECH_SAMPLES[i % TECH_SAMPLES.length];
    const ownerUserId = usnToUserId[usn] || null;
    const projectStatus = i % 2 === 0 ? 'approved' : 'draft';
    const selfRating = Math.min(5, Math.max(1, 2 + (i % 4)));
    const adminRating = i % 2 === 0 ? Math.min(5, Math.max(1, 3 + (i % 3))) : null;

    const projRes = await pool.query(
      `INSERT INTO projects (owner_usn, title, short_description, description, category, visibility, hosted_url, github_url, mentor_name, tech_stack, priority, owner_user_id, project_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        usn,
        title,
        `${title} – student project for ${genre}.`,
        `This project implements ${title}. It was developed as part of the curriculum and demonstrates skills in ${tech.join(', ')}.`,
        genre,
        i % 3 === 0 ? 'PRIVATE' : 'PUBLIC',
        i % 4 === 0 ? 'https://example.com/demo' : null,
        i % 2 === 0 ? 'https://github.com/example/repo' : null,
        i % 3 === 0 ? 'Dr. Smith' : null,
        tech,
        (i % 3) + 1,
        ownerUserId,
        projectStatus,
      ]
    );

    const projectId = projRes.rows[0]?.id;
    if (!projectId) continue;

    for (let j = 0; j < PROJECT_SNAP_PATHS.length; j++) {
      const url = toStorageUrl(PROJECT_SNAP_PATHS[j]);
      await pool.query(
        `INSERT INTO project_assets (project_id, asset_type, asset_role, original_url, position)
         VALUES ($1, 'IMAGE', 'GALLERY', $2, $3)`,
        [projectId, url, j]
      );
    }

    if (ownerUserId) {
      await pool.query(
        `INSERT INTO project_ratings (project_id, user_id, rating) VALUES ($1, $2, $3)
         ON CONFLICT (project_id, user_id) DO UPDATE SET rating = EXCLUDED.rating`,
        [projectId, ownerUserId, selfRating]
      );
    }

    await pool.query(
      `INSERT INTO project_metrics (project_id, views, likes, favorites, avg_rating, rating_count, comments, last_updated)
       VALUES ($1, 0, 0, 0, 0, 0, 0, NOW())`,
      [projectId]
    );

    inserted++;
  }

  console.log(`Inserted ${inserted} projects (each with ${PROJECT_SNAP_PATHS.length} images).`);
  console.log('\nSeed completed.');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
