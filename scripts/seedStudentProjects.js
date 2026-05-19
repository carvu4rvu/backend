/**
 * Seed 5 projects for a single student (profile /student/profile/projects).
 *
 * Run from backend:
 *   node scripts/seedStudentProjects.js 1RVU23BSC099
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const DEFAULT_USN = '1RVU23BSC099';
const PROJECT_COUNT = 5;

const PROJECTS = [
  {
    title: 'Campus Library Management System',
    category: 'Web App',
    short: 'Web portal for book search, issue, and return tracking.',
    description:
      'Built a full-stack library system with role-based access for students and librarians, barcode-style issue logs, and overdue reminders.',
    tech: ['React', 'Node.js', 'PostgreSQL'],
    hosted: 'https://example.com/library-demo',
    github: 'https://github.com/example/campus-library',
    mentor: 'Dr. Priya Sharma',
  },
  {
    title: 'Smart Attendance using QR Codes',
    category: 'Mobile App',
    short: 'QR-based attendance app for lab sessions.',
    description:
      'Mobile-friendly attendance flow with session QR generation, geofenced check-in, and daily export for faculty.',
    tech: ['React Native', 'Express', 'MongoDB'],
    hosted: 'https://example.com/attendance-demo',
    github: 'https://github.com/example/smart-attendance',
    mentor: 'Dr. Ravi Menon',
  },
  {
    title: 'Student Portfolio CMS',
    category: 'Full Stack',
    short: 'CMS for students to publish projects and achievements.',
    description:
      'Modular CMS with drag-and-drop sections, image uploads, and admin approval workflow for public showcase.',
    tech: ['Next.js', 'Prisma', 'Supabase'],
    hosted: 'https://example.com/portfolio-cms',
    github: 'https://github.com/example/student-portfolio-cms',
    mentor: 'Dr. Anitha Rao',
  },
  {
    title: 'IoT Soil Moisture Monitor',
    category: 'IoT',
    short: 'Sensor dashboard for agriculture lab experiments.',
    description:
      'ESP32 sensors stream moisture and temperature to a live dashboard with threshold alerts and weekly CSV reports.',
    tech: ['Arduino', 'Python', 'MQTT', 'React'],
    hosted: 'https://example.com/soil-monitor',
    github: 'https://github.com/example/iot-soil-monitor',
    mentor: 'Dr. Kumaravel',
  },
  {
    title: 'Placement Prep Quiz Platform',
    category: 'Web App',
    short: 'Aptitude and technical quiz practice for placement drives.',
    description:
      'Timed quizzes with topic filters, leaderboards, and detailed explanations; supports bulk question import for trainers.',
    tech: ['Vue.js', 'Django', 'PostgreSQL'],
    hosted: 'https://example.com/placement-quiz',
    github: 'https://github.com/example/placement-quiz',
    mentor: 'Dr. Meera Iyer',
  },
];

function buildImageUrl(usn, projectOrdinal, assetOrdinal) {
  const label = encodeURIComponent(`${usn} P${projectOrdinal} Img${assetOrdinal}`);
  return `https://placehold.co/1280x720/png?text=${label}`;
}

async function deleteProjectsForUsn(client, usn) {
  const { rows } = await client.query('SELECT id FROM projects WHERE owner_usn = $1', [usn]);
  const projectIds = rows.map((r) => r.id);
  if (!projectIds.length) return 0;

  await client.query(
    'DELETE FROM project_asset_variants WHERE asset_id IN (SELECT id FROM project_assets WHERE project_id = ANY($1::bigint[]))',
    [projectIds]
  );
  await client.query('DELETE FROM project_assets WHERE project_id = ANY($1::bigint[])', [projectIds]);
  await client.query('DELETE FROM project_favorites WHERE project_id = ANY($1::bigint[])', [projectIds]);
  await client.query('DELETE FROM project_likes WHERE project_id = ANY($1::bigint[])', [projectIds]);
  await client.query('DELETE FROM project_reviews WHERE project_id = ANY($1::bigint[])', [projectIds]);
  await client.query('DELETE FROM project_share_links WHERE project_id = ANY($1::bigint[])', [projectIds]);
  await client.query('DELETE FROM project_views WHERE project_id = ANY($1::bigint[])', [projectIds]);
  await client.query('DELETE FROM project_metrics WHERE project_id = ANY($1::bigint[])', [projectIds]);
  await client.query('DELETE FROM projects WHERE id = ANY($1::bigint[])', [projectIds]);
  return projectIds.length;
}

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

    const { rows: loginRows } = await client.query(
      'SELECT id FROM user_login WHERE usn = $1 LIMIT 1',
      [usn]
    );
    const ownerUserId = loginRows[0]?.id || null;

    await client.query('BEGIN');
    const removed = await deleteProjectsForUsn(client, usn);
    if (removed) console.log(`Removed ${removed} existing project(s) for ${usn}.`);

    const insertedIds = [];
    for (let i = 0; i < PROJECTS.length; i++) {
      const p = PROJECTS[i];
      const priority = i + 1;
      const { rows: projRows } = await client.query(
        `INSERT INTO projects (
          owner_usn, owner_user_id, title, short_description, description, category,
          visibility, hosted_url, github_url, mentor_name, tech_stack,
          priority, project_status
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          'PRIVATE', $7, $8, $9, $10,
          $11, 'not_approved'
        )
        RETURNING id, title`,
        [
          usn,
          ownerUserId,
          p.title,
          p.short,
          p.description,
          p.category,
          p.hosted,
          p.github,
          p.mentor,
          p.tech,
          priority,
        ]
      );

      const projectId = projRows[0]?.id;
      if (!projectId) continue;
      insertedIds.push(projectId);

      for (let k = 0; k < 2; k++) {
        const assetRole = k === 0 ? 'COVER' : 'GALLERY';
        await client.query(
          `INSERT INTO project_assets (project_id, asset_type, asset_role, original_url, position)
           VALUES ($1, 'IMAGE', $2, $3, $4)`,
          [projectId, assetRole, buildImageUrl(usn, priority, k + 1), k]
        );
      }

      await client.query(
        `INSERT INTO project_metrics (project_id, views, likes, favorites, comments, last_updated)
         VALUES ($1, 0, 0, 0, 0, NOW())
         ON CONFLICT (project_id) DO NOTHING`,
        [projectId]
      );
    }

    await client.query('COMMIT');

    const { rows: countRows } = await client.query(
      'SELECT COUNT(*)::int AS count FROM projects WHERE owner_usn = $1',
      [usn]
    );
    console.log(`Seeded ${insertedIds.length} projects for ${usn}:`);
    PROJECTS.forEach((p, idx) => console.log(`  ${idx + 1}. ${p.title}`));
    console.log(`Total projects for ${usn}: ${countRows[0]?.count ?? 0}`);
    console.log('Refresh http://localhost:5173/student/profile/projects to view.');
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
