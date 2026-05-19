/**
 * Seed 10 personalized projects for students with accepted job offers.
 * Each project reflects the student's major, program, offer role, and profile traits.
 *
 * Run from backend:
 *   node scripts/seedOfferStudentProjects.js
 *   node scripts/seedOfferStudentProjects.js --limit=10
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith('--limit='));
  return arg ? Math.max(1, parseInt(arg.split('=')[1], 10) || 10) : 10;
})();

/** Personality + program-aware project blueprints keyed by USN suffix patterns / explicit USN */
const PROJECT_BLUEPRINTS = {
  '1RUA22BSC002': {
    title: 'Campus Attendance Anomaly Detector',
    category: 'ML/AI',
    short: 'ML pipeline that flags unusual attendance patterns for advisors.',
    description:
      'Built an end-to-end anomaly detection workflow using Python and scikit-learn on historical attendance logs. Kyra’s analytical mindset from the Data Science & AI ML major drove feature engineering around late arrivals and section-wise drift. Includes a Streamlit dashboard for placement coordinators and exportable reports aligned with SoCSE BSc H capstone expectations.',
    tech: ['Python', 'scikit-learn', 'Pandas', 'Streamlit', 'PostgreSQL'],
    mentor: 'Dr. Meera Krishnan',
    tags: ['machine-learning', 'campus-analytics', 'data-science'],
  },
  '1RUA22BSC003': {
    title: 'Peer Code Review Hub for RVU Labs',
    category: 'Full Stack',
    short: 'Collaborative review platform for lab submissions and rubrics.',
    description:
      'A full-stack portal where students submit PRs, receive structured peer feedback, and track rubric scores. Dev’s collaborative builder style fits the Full Stack Development track—React frontend, Express API, and role-based workflows for TAs. Designed for BSc H lab courses with GitHub OAuth and notification digests.',
    tech: ['React', 'Node.js', 'Express', 'PostgreSQL', 'GitHub OAuth'],
    mentor: 'Dr. Ravi Menon',
    tags: ['full-stack', 'collaboration', 'education'],
  },
  '1RUA22BSC004': {
    title: 'Accessible Campus Navigation PWA',
    category: 'Web App',
    short: 'Mobile-first wayfinding with WCAG-compliant UI for new students.',
    description:
      'Progressive web app mapping buildings, ramps, and elevators with voice-friendly directions. Navya focused on inclusive UX—high contrast themes, keyboard navigation, and offline map tiles—matching her user-centered Full Stack profile and Aetheriq Full Stack Developer offer path.',
    tech: ['Next.js', 'TypeScript', 'Mapbox GL', 'PWA', 'Tailwind CSS'],
    mentor: 'Dr. Anitha Rao',
    tags: ['accessibility', 'pwa', 'ux'],
  },
  '1RUA22BSC006': {
    title: 'Student Clubs Event Bus API',
    category: 'API',
    short: 'Event-driven microservice backbone for club registrations.',
    description:
      'Backend-centric architecture using Node.js and Redis streams to decouple club sign-ups, waitlists, and email triggers. Chitra’s systematic approach suits her Backend Developer role—OpenAPI docs, idempotent webhooks, and audit logs for SoCSE student society operations.',
    tech: ['Node.js', 'Redis', 'PostgreSQL', 'OpenAPI', 'Docker'],
    mentor: 'Dr. Kumaravel',
    tags: ['backend', 'microservices', 'events'],
  },
  '1RUA22BSC007': {
    title: 'RVU Design System Playground',
    category: 'Web App',
    short: 'Interactive component gallery for consistent portal UIs.',
    description:
      'Living style guide with Chakra-based tokens, dark mode, and copy-paste snippets for student and admin portals. Vivaan’s visual creativity as a Frontend Developer shines through motion previews, responsive breakpoints, and Storybook integration for the BSc H product cohort.',
    tech: ['React', 'Chakra UI', 'Storybook', 'Vite', 'Figma Tokens'],
    mentor: 'Dr. Priya Sharma',
    tags: ['frontend', 'design-system', 'ui'],
  },
  '1RUA22BSC008': {
    title: 'Multilingual Campus Feedback Sentiment Engine',
    category: 'ML/AI',
    short: 'NLP service scoring student feedback in English, Hindi, and Kannada.',
    description:
      'Fine-tuned transformer pipeline for sentiment and topic clustering on event surveys. Tara’s curiosity as an ML Engineer—despite a Full Stack major—shows in model comparison notebooks, FastAPI inference, and batch jobs that feed placement drive retrospectives.',
    tech: ['Python', 'Hugging Face', 'FastAPI', 'React', 'PostgreSQL'],
    mentor: 'Dr. Sanjay Patel',
    tags: ['nlp', 'ml', 'multilingual'],
  },
  '1RUA22BSC010': {
    title: 'Placement Portal Regression Automation Suite',
    category: 'DevOps',
    short: 'Playwright + CI suite guarding critical placement workflows.',
    description:
      'End-to-end test harness covering registration, opt-in, and offer acceptance flows with flaky-test retries and HTML reports. Anika’s detail-oriented QA Engineer mindset drives coverage matrices mapped to drive rounds and screenshot diffs on every PR.',
    tech: ['Playwright', 'GitHub Actions', 'Node.js', 'Allure Reports'],
    mentor: 'Dr. Lakshmi Iyer',
    tags: ['qa', 'automation', 'placement'],
  },
  '1RUA22BSC011': {
    title: 'Feature Prioritization Board from User Stories',
    category: 'Full Stack',
    short: 'RICE-scored backlog tool linking stories to mock sprint goals.',
    description:
      'Product-engineering dashboard where teams import Jira-style stories, score impact, and visualize roadmap quarters. Advait blends Data Science rigor with product thinking—analytics on velocity, stakeholder votes, and export for BSc H entrepreneurship electives.',
    tech: ['Vue.js', 'Django', 'PostgreSQL', 'Chart.js'],
    mentor: 'Dr. Neha Desai',
    tags: ['product', 'agile', 'analytics'],
  },
  '1RUA22BSC012': {
    title: 'Dev Lab Kubernetes Cost & Health Monitor',
    category: 'DevOps',
    short: 'Grafana dashboards for namespace quotas and pod restarts.',
    description:
      'Cloud-native observability stack polling lab clusters, alerting on OOM kills and idle nodes. Ishita’s infrastructure focus as Cloud Engineer includes Terraform snippets, Prometheus metrics, and cost breakdowns per student project namespace.',
    tech: ['Kubernetes', 'Prometheus', 'Grafana', 'Terraform', 'Go'],
    mentor: 'Dr. Arun Hegde',
    tags: ['cloud', 'devops', 'observability'],
  },
  '1RUA22BSC024': {
    title: 'Orbitara-Style API Gateway Simulator',
    category: 'API',
    short: 'Rate-limited gateway mock for integration testing placement APIs.',
    description:
      'Lightweight gateway with JWT validation, request logging, and mock upstreams—built while preparing for Orbitara’s Software Engineer track. Tanya’s Full Stack major informed OpenAPI-first design and load tests simulating peak registration traffic.',
    tech: ['Go', 'Redis', 'PostgreSQL', 'k6', 'Docker'],
    mentor: 'Dr. Vikram Singh',
    tags: ['api-gateway', 'integration', 'backend'],
  },
};

const FALLBACK_BY_MAJOR = {
  'data science': {
    title: 'Predictive GPA & Engagement Insights',
    category: 'Data Science',
    short: 'Regression models on LMS activity to surface at-risk students.',
    description: 'Data science capstone using Python, SQL, and dashboards for academic advisors.',
    tech: ['Python', 'SQL', 'Plotly', 'scikit-learn'],
    mentor: 'Dr. Meera Krishnan',
    tags: ['analytics', 'education'],
  },
  'full stack': {
    title: 'Unified Student Services Portal',
    category: 'Full Stack',
    short: 'Single sign-on hub for fees, library, and placement modules.',
    description: 'Full-stack portal demonstrating REST integration and responsive UI for SoCSE students.',
    tech: ['React', 'Node.js', 'PostgreSQL'],
    mentor: 'Dr. Ravi Menon',
    tags: ['full-stack', 'portal'],
  },
  cybersecurity: {
    title: 'Threat Modeling Toolkit for Web Apps',
    category: 'Security',
    short: 'STRIDE-based checklist generator with exportable reports.',
    description: 'Security-focused tool for BTech Cybersecurity students documenting attack surfaces.',
    tech: ['React', 'Python', 'OWASP'],
    mentor: 'Dr. Arun Hegde',
    tags: ['security', 'threat-modeling'],
  },
};

const FALLBACK_BY_DESIGNATION = {
  'ml engineer': {
    title: 'Computer Vision Lab Equipment Tracker',
    category: 'ML/AI',
    short: 'YOLO-based inventory scan for shared lab devices.',
    description: 'ML pipeline for detecting and logging lab asset usage from camera feeds.',
    tech: ['Python', 'PyTorch', 'OpenCV', 'FastAPI'],
    mentor: 'Dr. Sanjay Patel',
    tags: ['computer-vision', 'ml'],
  },
  'devops engineer': {
    title: 'CI/CD Pipeline Template Library',
    category: 'DevOps',
    short: 'Reusable GitHub Actions workflows for student repos.',
    description: 'DevOps starter kit with lint, test, and deploy stages for campus projects.',
    tech: ['GitHub Actions', 'Docker', 'Node.js'],
    mentor: 'Dr. Arun Hegde',
    tags: ['devops', 'ci-cd'],
  },
  'qa engineer': {
    title: 'Cross-Browser UI Snapshot Tester',
    category: 'DevOps',
    short: 'Visual regression suite for student project demos.',
    description: 'Automated visual diff tool for QA-minded developers in placement prep.',
    tech: ['Playwright', 'Percy', 'Node.js'],
    mentor: 'Dr. Lakshmi Iyer',
    tags: ['qa', 'testing'],
  },
};

function buildImageUrl(usn, projectOrdinal, assetOrdinal) {
  const label = encodeURIComponent(`${usn} Offer P${projectOrdinal}`);
  return `https://placehold.co/1280x720/png?text=${label}`;
}

function slugify(name) {
  return String(name || 'student')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function pickBlueprint(student) {
  if (PROJECT_BLUEPRINTS[student.usn]) return PROJECT_BLUEPRINTS[student.usn];

  const majorKey = String(student.major || '').toLowerCase();
  const desigKey = String(student.designation || '').toLowerCase();

  for (const [k, v] of Object.entries(FALLBACK_BY_DESIGNATION)) {
    if (desigKey.includes(k)) return { ...v };
  }
  for (const [k, v] of Object.entries(FALLBACK_BY_MAJOR)) {
    if (majorKey.includes(k)) return { ...v };
  }
  return FALLBACK_BY_MAJOR['full stack'];
}

function personalizeDescription(blueprint, student) {
  const traits = [];
  if (student.hobbies_interests) traits.push(`interests in ${student.hobbies_interests}`);
  if (student.key_expertise) traits.push(`strength in ${student.key_expertise}`);
  if (student.career_objective) traits.push(`goal: ${student.career_objective}`);
  if (!traits.length) {
    traits.push(
      `${student.program || 'BSc H'} at ${student.school || 'SoCSE'}`,
      `${student.major || 'computing'} major`,
      `accepted ${student.designation || 'role'} at ${student.company || 'campus recruiter'}`
    );
  }
  const suffix = ` Tailored for ${student.full_name}'s profile (${traits.join('; ')}).`;
  if (blueprint.description.includes(student.full_name)) return blueprint.description;
  return blueprint.description + suffix;
}

async function fetchOfferStudents(client, limit) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (s.usn)
      s.usn, s.full_name,
      sch.name AS school, prg.name AS program,
      maj.name AS major,
      spd.key_expertise, spd.hobbies_interests, spd.career_objective,
      p.designation,
      COALESCE(c.company_name, pc.company_name) AS company
    FROM offers o
    JOIN student_basic_details s ON s.usn = o.student_id
    LEFT JOIN schools sch ON sch.id = s.school_id
    LEFT JOIN programs prg ON prg.id = s.program_id
    LEFT JOIN majors maj ON maj.id = s.major_id
    LEFT JOIN student_profile_details spd ON spd.usn = s.usn
    LEFT JOIN placement p ON p.id = o.placement_id
    LEFT JOIN companies c ON c.id = o.company_id
    LEFT JOIN companies pc ON pc.id = p.company_id
    WHERE o.is_accepted = true
    ORDER BY s.usn, o.id DESC`,
    []
  );

  const prioritized = [];
  const blueprintUsns = Object.keys(PROJECT_BLUEPRINTS);
  for (const usn of blueprintUsns) {
    const found = rows.find((r) => r.usn === usn);
    if (found) prioritized.push(found);
  }
  for (const r of rows) {
    if (!prioritized.some((p) => p.usn === r.usn)) prioritized.push(r);
  }
  return prioritized.slice(0, limit);
}

async function main() {
  const client = await pool.connect();
  let inserted = 0;

  try {
    const students = await fetchOfferStudents(client, LIMIT);
    if (!students.length) {
      console.error('No students with accepted offers found. Run seedAetheriqDrives.js or seedJobOffers.js first.');
      process.exit(1);
    }

    const { rows: loginRows } = await client.query(
      'SELECT id, usn FROM user_login WHERE usn = ANY($1::text[])',
      [students.map((s) => s.usn)]
    );
    const usnToUserId = Object.fromEntries(loginRows.map((r) => [r.usn, r.id]));

    await client.query('BEGIN');

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      const blueprint = pickBlueprint(student);
      const slug = slugify(student.full_name);
      const priorityRes = await client.query(
        'SELECT COALESCE(MAX(priority), 0)::int AS max_pri FROM projects WHERE owner_usn = $1',
        [student.usn]
      );
      const priority = (priorityRes.rows[0]?.max_pri || 0) + 1;

      const description = personalizeDescription(blueprint, student);
      const hosted = `https://demo.rvu.edu.in/projects/${slug}/${priority}`;
      const github = `https://github.com/rvu-${slug}/${slugify(blueprint.title)}`;
      const tags = blueprint.tags || [];

      const { rows: projRows } = await client.query(
        `INSERT INTO projects (
          owner_usn, owner_user_id, title, short_description, description, category,
          tags, visibility, hosted_url, github_url, mentor_name, tech_stack,
          priority, project_status, published_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, 'PUBLIC', $8, $9, $10, $11,
          $12, 'approved', NOW()
        )
        RETURNING id, title`,
        [
          student.usn,
          usnToUserId[student.usn] || null,
          blueprint.title,
          blueprint.short,
          description,
          blueprint.category,
          tags,
          hosted,
          github,
          blueprint.mentor,
          blueprint.tech,
          priority,
        ]
      );

      const projectId = projRows[0]?.id;
      if (!projectId) continue;

      for (let k = 0; k < 2; k++) {
        await client.query(
          `INSERT INTO project_assets (project_id, asset_type, asset_role, original_url, position)
           VALUES ($1, 'IMAGE', $2, $3, $4)`,
          [projectId, k === 0 ? 'COVER' : 'GALLERY', buildImageUrl(student.usn, priority, k + 1), k]
        );
      }

      await client.query(
        `INSERT INTO project_metrics (project_id, views, likes, favorites, comments, last_updated)
         VALUES ($1, $2, $3, 0, 0, NOW())
         ON CONFLICT (project_id) DO NOTHING`,
        [projectId, 12 + i * 3, 2 + (i % 4)]
      );

      inserted += 1;
      console.log(`✓ ${student.full_name} (${student.usn}) → ${blueprint.title}`);
    }

    await client.query('COMMIT');
    console.log(`\nSeeded ${inserted} personalized project(s) for students with accepted offers.`);
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
