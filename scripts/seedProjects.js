/**
 * Seed script: inserts at least 20 student projects with 4+ images each.
 * Run from backend: node scripts/seedProjects.js
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Run seedStudents.js first so student_basic_details has USNs.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');

// 4 image paths under public/projects/STUD1_23 (reused for all seed projects so each has 4 images)
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

async function seed() {
  console.log('Seeding student projects...\n');

  const { data: students, error: studentsErr } = await supabase.from('student_basic_details').select('usn');
  if (studentsErr || !students?.length) {
    console.error('No students found. Run seedStudents.js first.');
    process.exit(1);
  }

  const usns = students.map((s) => s.usn);
  const { data: existingProjects } = await supabase.from('student_projects').select('id');
  const existingCount = existingProjects?.length ?? 0;

  const toInsert = [];
  const n = Math.max(20, usns.length);
  for (let i = 0; i < n; i++) {
    const usn = usns[i % usns.length];
    const title = TITLES[i % TITLES.length];
    const genre = GENRES[i % GENRES.length];
    const tech = TECH_SAMPLES[i % TECH_SAMPLES.length];
    toInsert.push({
      usn,
      title,
      one_line_description: `${title} – student project for ${genre}.`,
      full_description: `This project implements ${title}. It was developed as part of the curriculum and demonstrates skills in ${tech.join(', ')}.`,
      genre,
      visibility: i % 3 === 0 ? 'PRIVATE' : 'PUBLIC',
      self_rating: Math.min(10, Math.max(1, 5 + (i % 5))),
      admin_rating: i % 2 === 0 ? Math.min(10, Math.max(1, 6 + (i % 4))) : null,
      priority: (i % 3) + 1,
      project_snaps: PROJECT_SNAP_PATHS,
      hosted_link: i % 4 === 0 ? 'https://example.com/demo' : null,
      github_repo: i % 2 === 0 ? 'https://github.com/example/repo' : null,
      mentor_name: i % 3 === 0 ? 'Dr. Smith' : null,
      technologies: tech,
      is_approved: i % 2 === 0,
    });
  }

  const { data: inserted, error } = await supabase.from('student_projects').insert(toInsert).select('id');
  if (error) {
    console.error('Insert error:', error.message);
    process.exit(1);
  }
  console.log('Inserted', inserted?.length ?? toInsert.length, 'student projects (each with', PROJECT_SNAP_PATHS.length, 'images).');
  console.log('\nSeed completed.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
