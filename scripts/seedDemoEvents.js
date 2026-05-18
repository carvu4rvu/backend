/**
 * Seed realistic demo events into the events table (PostgreSQL).
 * Populates Upcoming / Ongoing / Done / Failed tabs for UI testing.
 * Does NOT create notifications, invites, or attendee records.
 *
 * Run from backend:
 *   node scripts/seedDemoEvents.js
 *   DRY_RUN=1 node scripts/seedDemoEvents.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

/** Reference "now" for consistent demo dates (IST-friendly ISO strings). */
const NOW = new Date('2026-05-18T10:00:00+05:30');

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function addHours(base, hours) {
  const d = new Date(base);
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

function buildDetails(meta) {
  const lines = [
    meta.summary,
    '',
    `Venue: ${meta.venue}`,
    `Organizer: ${meta.organizer}`,
    `Department: ${meta.department}`,
    `Category: ${meta.category}`,
    `Audience: ${meta.audience}`,
    `Capacity: ${meta.capacity} | Registered: ${meta.registered}`,
  ];
  if (meta.note) lines.push(`Note: ${meta.note}`);
  return lines.join('\n');
}

const DEMO_EVENTS = [
  // —— Upcoming (scheduled) ——
  {
    title: 'Campus Hackathon 2026: Build for Impact',
    type: 'Hackathon',
    status: 'scheduled',
    event_datetime: addDays(NOW, 12),
    details: buildDetails({
      summary:
        '48-hour hackathon with themes in EdTech, HealthTech, and FinTech. Teams of 2–4, mentorship from industry engineers, prizes for top three teams.',
      venue: 'Innovation Lab, Block 5',
      organizer: 'CSI Student Chapter & T&P Cell',
      department: 'School of Computing & Engineering (SOCSE)',
      category: 'Technical Competition',
      audience: 'All UG/PG students (pre-registration required)',
      capacity: 120,
      registered: 89,
    }),
  },
  {
    title: 'Placement Orientation 2026–27',
    type: 'Placement',
    status: 'scheduled',
    event_datetime: addDays(NOW, 5),
    details: buildDetails({
      summary:
        'Mandatory orientation on placement policy, eligibility, dress code, and drive calendar. Q&A with placement coordinators.',
      venue: 'Main Auditorium',
      organizer: 'Training & Placement Cell',
      department: 'All Schools',
      category: 'Placement Briefing',
      audience: 'Final-year students (all programs)',
      capacity: 800,
      registered: 612,
    }),
  },
  {
    title: 'Resume & LinkedIn Workshop',
    type: 'Workshop',
    status: 'scheduled',
    event_datetime: addDays(NOW, 8),
    details: buildDetails({
      summary:
        'Hands-on session on ATS-friendly resumes, action verbs, and LinkedIn profile optimization. Bring a draft resume.',
      venue: 'Seminar Hall B, Admin Block',
      organizer: 'Career Services Team',
      department: 'School of Management (SOM)',
      category: 'Career Skills',
      audience: 'Pre-final and final-year students',
      capacity: 150,
      registered: 134,
    }),
  },
  {
    title: 'AI in Industry: Trends & Careers Seminar',
    type: 'Workshop',
    status: 'scheduled',
    event_datetime: addDays(NOW, 15),
    details: buildDetails({
      summary:
        'Panel on generative AI, MLOps, and hiring trends. Speakers from product and research teams at leading tech firms.',
      venue: 'Conference Room 301, SOCSE',
      organizer: 'Department of CSE & Industry Relations',
      department: 'SOCSE — Computer Science',
      category: 'Industry Talk',
      audience: 'CSE, IT, and allied branches',
      capacity: 200,
      registered: 178,
    }),
  },
  {
    title: 'Internship Fair — Summer 2026',
    type: 'Career Fair',
    status: 'scheduled',
    event_datetime: addDays(NOW, 21),
    details: buildDetails({
      summary:
        'Meet recruiters offering summer internships across software, analytics, and core engineering. Carry two copies of your resume.',
      venue: 'Sports Complex Exhibition Hall',
      organizer: 'T&P Cell & Corporate Relations',
      department: 'All Schools',
      category: 'Recruitment',
      audience: 'Second-year onwards (eligible batches only)',
      capacity: 500,
      registered: 341,
    }),
  },
  {
    title: 'Mock Interview Day — Product & SDE Roles',
    type: 'Training',
    status: 'scheduled',
    event_datetime: addDays(NOW, 10),
    details: buildDetails({
      summary:
        'One-on-one mock technical and HR interviews with alumni volunteers. Slots assigned after registration closes.',
      venue: 'Interview Pods, Placement Block',
      organizer: 'Alumni Mentorship Network',
      department: 'SOCSE & SOET',
      category: 'Interview Prep',
      audience: 'Final-year B.Tech / M.Tech',
      capacity: 80,
      registered: 76,
    }),
  },

  // —— Ongoing ——
  {
    title: 'Week of Code — Coding Challenge (Day 2)',
    type: 'Contest',
    status: 'ongoing',
    event_datetime: addHours(NOW, -6),
    details: buildDetails({
      summary:
        'Three-day competitive programming contest. Leaderboard updates every hour. Day 2 focuses on graphs and dynamic programming.',
      venue: 'Computer Center Lab 1–4',
      organizer: 'Programming Club',
      department: 'SOCSE',
      category: 'Coding Contest',
      audience: 'All students with portal login',
      capacity: 300,
      registered: 256,
      note: 'Event in progress — submissions open until 6:00 PM IST today.',
    }),
  },
  {
    title: 'Industry Talk: Cloud & DevOps at Scale',
    type: 'Workshop',
    status: 'ongoing',
    event_datetime: addHours(NOW, -2),
    details: buildDetails({
      summary:
        'Live session on CI/CD, Kubernetes, and observability. Interactive demos and open floor for questions.',
      venue: 'Auditorium C',
      organizer: 'AWS Student Community Chapter',
      department: 'SOCSE — IT & CSE',
      category: 'Industry Talk',
      audience: 'Third-year and final-year students',
      capacity: 250,
      registered: 219,
      note: 'Session started at 10:00 AM IST; late entry allowed until 10:30 AM.',
    }),
  },
  {
    title: 'GD Practice Marathon',
    type: 'Training',
    status: 'ongoing',
    event_datetime: addHours(NOW, -1),
    details: buildDetails({
      summary:
        'Rotating group discussion topics with immediate feedback from faculty and senior students. Multiple parallel rooms.',
      venue: 'Classrooms 201–210, Academic Block',
      organizer: 'Soft Skills Cell',
      department: 'School of Humanities & Sciences',
      category: 'Communication Skills',
      audience: 'Placement-registered students',
      capacity: 120,
      registered: 98,
    }),
  },
  {
    title: 'Design Thinking Sprint — Campus Innovation',
    type: 'Workshop',
    status: 'ongoing',
    event_datetime: addDays(NOW, 0),
    details: buildDetails({
      summary:
        'Full-day sprint: empathize, ideate, prototype. Teams present wireframes by end of day.',
      venue: 'Design Studio, SOAD',
      organizer: 'School of Architecture & Design',
      department: 'SOAD',
      category: 'Interdisciplinary Workshop',
      audience: 'Cross-disciplinary teams (pre-formed)',
      capacity: 60,
      registered: 58,
    }),
  },
  {
    title: 'Employability Skills Bootcamp (Week 1)',
    type: 'Training',
    status: 'ongoing',
    event_datetime: addDays(NOW, -1),
    details: buildDetails({
      summary:
        'Five-day bootcamp covering aptitude, verbal ability, and logical reasoning. Week 1 modules run Mon–Fri this week.',
      venue: 'Lecture Hall 12',
      organizer: 'T&P Cell',
      department: 'All Schools',
      category: 'Aptitude Training',
      audience: 'First-year PG and pre-final UG',
      capacity: 180,
      registered: 165,
    }),
  },

  // —— Done (completed) ——
  {
    title: 'Annual Career Fair 2025',
    type: 'Career Fair',
    status: 'completed',
    event_datetime: addDays(NOW, -45),
    details: buildDetails({
      summary:
        'Successfully concluded with 42 companies and 1,200+ student interactions. Summary report shared with departments.',
      venue: 'Convention Center',
      organizer: 'T&P Cell',
      department: 'All Schools',
      category: 'Recruitment',
      audience: 'Final-year students',
      capacity: 600,
      registered: 587,
      note: 'Completed — attendance 94%.',
    }),
  },
  {
    title: 'Resume Review Clinic — March Batch',
    type: 'Workshop',
    status: 'completed',
    event_datetime: addDays(NOW, -30),
    details: buildDetails({
      summary:
        'One-on-one resume reviews completed for 98 students. Revised templates uploaded to the placement portal.',
      venue: 'Counselling Rooms 1–6',
      organizer: 'Career Services Team',
      department: 'SOCSE & SOM',
      category: 'Career Skills',
      audience: 'Final-year students',
      capacity: 100,
      registered: 98,
    }),
  },
  {
    title: 'Data Structures Refresher — Placement Prep',
    type: 'Training',
    status: 'completed',
    event_datetime: addDays(NOW, -20),
    details: buildDetails({
      summary:
        'Intensive review of arrays, trees, graphs, and common interview patterns. Practice sheets and solutions published.',
      venue: 'SOCSE Seminar Hall',
      organizer: 'Department of CSE',
      department: 'SOCSE',
      category: 'Technical Training',
      audience: 'CSE & IT final-year',
      capacity: 150,
      registered: 142,
    }),
  },
  {
    title: 'Startup Networking Mixer — Winter Edition',
    type: 'Networking',
    status: 'completed',
    event_datetime: addDays(NOW, -60),
    details: buildDetails({
      summary:
        'Founders and students connected over pitch decks and mentorship sign-ups. 15 startups represented.',
      venue: 'Incubation Center Lounge',
      organizer: 'Entrepreneurship Cell',
      department: 'School of Management',
      category: 'Networking',
      audience: 'Students with startup interest',
      capacity: 80,
      registered: 72,
    }),
  },
  {
    title: 'Aptitude Test — Mock Drive #1',
    type: 'Contest',
    status: 'completed',
    event_datetime: addDays(NOW, -14),
    details: buildDetails({
      summary:
        'Full-length aptitude mock under exam conditions. Scores and percentile ranks available on the student dashboard.',
      venue: 'Examination Hall A & B',
      organizer: 'T&P Cell',
      department: 'All Schools',
      category: 'Assessment',
      audience: 'Placement-registered students',
      capacity: 400,
      registered: 388,
    }),
  },
  {
    title: 'Women in Tech Leadership Panel',
    type: 'Workshop',
    status: 'completed',
    event_datetime: addDays(NOW, -25),
    details: buildDetails({
      summary:
        'Panel on career paths, negotiation, and mentorship. Recording available on the internal LMS.',
      venue: 'Main Auditorium',
      organizer: 'WiT Chapter & HR',
      department: 'All Schools',
      category: 'Diversity & Inclusion',
      audience: 'All students and faculty',
      capacity: 350,
      registered: 301,
    }),
  },

  // —— Failed / cancelled / postponed ——
  {
    title: 'Campus Drive — TCS (Postponed)',
    type: 'Placement',
    status: 'failed',
    event_datetime: addDays(NOW, -10),
    details: buildDetails({
      summary:
        'Campus drive postponed due to scheduling conflict at company HQ. New date to be announced by T&P.',
      venue: 'Placement Block — Interview Floors',
      organizer: 'T&P Cell',
      department: 'SOCSE & SOET',
      category: 'Campus Recruitment',
      audience: 'Eligible CSE/IT students',
      capacity: 200,
      registered: 187,
      note: 'Status: Postponed — registrations frozen until reschedule.',
    }),
  },
  {
    title: 'Outdoor Team Building — Monsoon Edition',
    type: 'Other',
    status: 'failed',
    event_datetime: addDays(NOW, -7),
    details: buildDetails({
      summary:
        'Cancelled due to severe weather warning. Registered students notified; no penalty for absence.',
      venue: 'University Sports Ground',
      organizer: 'Student Welfare Office',
      department: 'All Schools',
      category: 'Student Life',
      audience: 'Club members and volunteers',
      capacity: 100,
      registered: 84,
      note: 'Status: Cancelled.',
    }),
  },
  {
    title: 'Blockchain Workshop with External Trainer',
    type: 'Workshop',
    status: 'failed',
    event_datetime: addDays(NOW, -18),
    details: buildDetails({
      summary:
        'Cancelled — external speaker unavailable. Alternative self-paced module added to the LMS.',
      venue: 'Lab 204, SOCSE',
      organizer: 'Department of IT',
      department: 'SOCSE — IT',
      category: 'Technical Workshop',
      audience: 'Third-year IT students',
      capacity: 60,
      registered: 55,
      note: 'Status: Cancelled.',
    }),
  },
  {
    title: 'Infosys Pre-Placement Talk',
    type: 'Placement',
    status: 'failed',
    event_datetime: addDays(NOW, -3),
    details: buildDetails({
      summary:
        'Session failed to start — virtual link expired before host joined. Reschedule in coordination with company POC.',
      venue: 'Online (Microsoft Teams)',
      organizer: 'Corporate Relations',
      department: 'SOCSE',
      category: 'Pre-Placement Talk',
      audience: 'Eligible final-year batch',
      capacity: 300,
      registered: 276,
      note: 'Status: Failed — technical issue.',
    }),
  },
  {
    title: 'International University Fair — EU Delegates',
    type: 'Career Fair',
    status: 'failed',
    event_datetime: addDays(NOW, -35),
    details: buildDetails({
      summary:
        'Postponed indefinitely — visa delays for delegate travel. Interested students may contact IR office for brochures.',
      venue: 'International Relations Office',
      organizer: 'International Relations Cell',
      department: 'All Schools',
      category: 'Higher Education',
      audience: 'Students exploring MS abroad',
      capacity: 150,
      registered: 112,
      note: 'Status: Postponed indefinitely.',
    }),
  },
  {
    title: 'Night Hackathon — 12-Hour Sprint',
    type: 'Hackathon',
    status: 'failed',
    event_datetime: addDays(NOW, -50),
    details: buildDetails({
      summary:
        'Event cancelled after low registration threshold not met. Refund of security deposit processed for early registrants.',
      venue: 'Library After-Hours Zone',
      organizer: 'Coding Club',
      department: 'SOCSE',
      category: 'Technical Competition',
      audience: 'All UG students',
      capacity: 80,
      registered: 28,
      note: 'Status: Cancelled — insufficient registrations.',
    }),
  },
];

async function ensureStatusColumn() {
  const res = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'status'
  `);
  if (res.rows.length === 0) {
    await pool.query(`
      ALTER TABLE public.events
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scheduled'
    `);
    console.log('[schema] Added events.status column');
  }
}

async function countByStatus() {
  const { rows } = await pool.query(
    `SELECT COALESCE(status, 'scheduled') AS status, COUNT(*)::int AS count
     FROM events GROUP BY COALESCE(status, 'scheduled') ORDER BY status`
  );
  return rows;
}

async function seed() {
  await ensureStatusColumn();

  const before = await countByStatus();
  console.log('Existing events (before):', before.length ? before : 'none');

  const inserted = [];
  const errors = [];

  for (const e of DEMO_EVENTS) {
    const row = {
      title: e.title,
      type: e.type,
      details: e.details || null,
      event_datetime: e.event_datetime || null,
      images: [],
      attachments: [],
      status: e.status,
    };

    if (DRY_RUN) {
      console.log('[DRY_RUN] Would insert:', row.title, '|', row.status, '|', row.event_datetime);
      inserted.push({ id: '(dry-run)', title: row.title, status: row.status });
      continue;
    }

    const keys = Object.keys(row);
    const placeholders = keys.map((_, i) => `$${i + 1}`);
    try {
      const { rows } = await pool.query(
        `INSERT INTO events (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id, title, status`,
        keys.map((k) => row[k])
      );
      const created = rows[0];
      inserted.push(created);
      console.log('Inserted:', created.id, '|', created.title, '|', created.status);
    } catch (err) {
      errors.push({ title: e.title, message: err.message });
      console.error('Insert error:', e.title, err.message);
    }
  }

  const after = DRY_RUN ? null : await countByStatus();
  const distribution = {};
  for (const ev of DEMO_EVENTS) {
    distribution[ev.status] = (distribution[ev.status] || 0) + 1;
  }

  console.log('\n--- Summary ---');
  console.log('Mode:', DRY_RUN ? 'DRY_RUN (no writes)' : 'LIVE');
  console.log('Attempted:', DEMO_EVENTS.length);
  console.log('Inserted:', inserted.length);
  console.log('Errors:', errors.length);
  if (errors.length) console.log('Failed titles:', errors.map((x) => x.title).join(', '));
  console.log('Planned status distribution:', distribution);
  if (after) {
    console.log('Database status distribution (all events):', after);
    const tabMin = ['scheduled', 'ongoing', 'completed', 'failed'].map((s) => {
      const found = after.find((r) => r.status === s);
      return `${s}: ${found ? found.count : 0}`;
    });
    console.log('Tab counts:', tabMin.join(' | '));
  }
  console.log('Created IDs:', inserted.map((r) => r.id).join(', '));
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
