/**
 * Create 6 events (3 alumni + 3 company) and invite:
 * - Primary audience (all alumni OR all companies) per event type
 * - All VC users on every event
 * - All placement-eligible students on every event
 *
 * Run: node scripts/seedSixEventsWithInvites.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const ALUMNI_EVENTS = [
  {
    title: 'Alumni Networking Evening 2026',
    type: 'Networking',
    details:
      'Connect with fellow alumni over dinner and round-table discussions. Share experiences and mentor current students.',
    event_datetime: addDays(7),
    audienceRole: 'alumni',
  },
  {
    title: 'Alumni Industry Insights Panel',
    type: 'Workshop',
    details:
      'Senior alumni from product, finance, and consulting share career journeys. Open Q&A for students and alumni.',
    event_datetime: addDays(14),
    audienceRole: 'alumni',
  },
  {
    title: 'Alumni Campus Homecoming',
    type: 'Meetup',
    details:
      'Walk the campus, meet faculty, and join batch reunions. Registration required for campus pass.',
    event_datetime: addDays(21),
    audienceRole: 'alumni',
  },
];

const COMPANY_EVENTS = [
  {
    title: 'Industry Partnership Summit 2026',
    type: 'Summit',
    details:
      'Meet placement leadership and explore long-term hiring partnerships. Agenda includes policy briefing and networking lunch.',
    event_datetime: addDays(10),
    audienceRole: 'company',
  },
  {
    title: 'Campus Hiring Connect – Summer 2026',
    type: 'Career Fair',
    details:
      'Companies meet placement-eligible students for internships and full-time roles. Bring job descriptions and interview panels.',
    event_datetime: addDays(18),
    audienceRole: 'company',
  },
  {
    title: 'Employer Branding & Campus Outreach Workshop',
    type: 'Workshop',
    details:
      'Best practices for pre-placement talks, hackathon sponsorships, and student engagement on campus.',
    event_datetime: addDays(25),
    audienceRole: 'company',
  },
];

async function ensureStatusColumn() {
  const res = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'status'
  `);
  if (res.rows.length === 0) {
    await pool.query(
      `ALTER TABLE public.events ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scheduled'`
    );
  }
}

async function getUserIdsByRoles(roleNames) {
  if (!roleNames.length) return [];
  const names = roleNames.map((r) => r.toLowerCase());
  const { rows } = await pool.query(
    `SELECT ul.id FROM user_login ul
     JOIN roles r ON r.id = ul.role_id
     WHERE lower(r.name) = ANY($1::text[]) AND ul.is_active = true`,
    [names]
  );
  return rows.map((r) => r.id);
}

async function getEligibleStudentUserIds() {
  const { rows } = await pool.query(
    `SELECT ul.id
     FROM user_login ul
     JOIN roles r ON r.id = ul.role_id
     JOIN student_basic_details s ON s.usn = ul.usn
     WHERE lower(r.name) = 'student'
       AND ul.is_active = true
       AND COALESCE(s.is_placement_eligible, false) = true`
  );
  return rows.map((r) => r.id);
}

async function resolveRecipientEntityIds(userIds) {
  if (!userIds.length) return [];
  const { rows } = await pool.query(
    `SELECT ul.id, ul.usn, ul.company_id, ul.email_id, r.name AS role
     FROM user_login ul
     JOIN roles r ON r.id = ul.role_id
     WHERE ul.id = ANY($1::bigint[])`,
    [userIds]
  );
  const alumniEmails = rows
    .filter((r) => r.role && r.role.toLowerCase() === 'alumni')
    .map((r) => r.email_id)
    .filter(Boolean);
  let alumniByEmail = new Map();
  if (alumniEmails.length) {
    const alumniRes = await pool.query(
      'SELECT id, personal_email FROM alumni WHERE personal_email = ANY($1::text[])',
      [alumniEmails]
    );
    (alumniRes.rows || []).forEach((a) => alumniByEmail.set(a.personal_email, a.id));
  }
  return rows.map((r) => {
    let entity_id = null;
    if (r.usn) entity_id = r.usn;
    else if (r.company_id != null) entity_id = String(r.company_id);
    else if (r.role && r.role.toLowerCase() === 'alumni' && r.email_id) {
      const aid = alumniByEmail.get(r.email_id);
      if (aid != null) entity_id = String(aid);
    }
    return {
      user_id: r.id,
      user_role: r.role || null,
      recipient_entity_id: entity_id,
    };
  });
}

async function insertEvent(ev) {
  const row = {
    title: ev.title,
    type: ev.type,
    details: ev.details,
    event_datetime: ev.event_datetime,
    images: [],
    attachments: [],
    status: 'scheduled',
  };
  const keys = Object.keys(row);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO events (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id, title`,
    keys.map((k) => row[k])
  );
  return rows[0];
}

async function createEventWithInvites(ev) {
  const created = await insertEvent(ev);
  const eventId = created.id;
  const link = `${FRONTEND_URL}/events/${eventId}`;
  const targetRole = ev.audienceRole;

  const notifRes = await pool.query(
    `INSERT INTO notifications (title, message, link, target_type, target_role, is_active, notification_type)
     VALUES ($1, $2, $3, 'ROLE', $4, true, 'EVENT')
     RETURNING id`,
    [ev.title, ev.details, link, targetRole]
  );
  const notificationId = notifRes.rows[0].id;

  const [primaryIds, vcIds, studentIds] = await Promise.all([
    getUserIdsByRoles([targetRole]),
    getUserIdsByRoles(['vc']),
    getEligibleStudentUserIds(),
  ]);

  const allIds = [...new Set([...primaryIds, ...vcIds, ...studentIds])];
  const recipientRows = await resolveRecipientEntityIds(allIds);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  let nodes = 0;
  for (const row of recipientRows) {
    await pool.query(
      `INSERT INTO notification_nodes (notification_id, user_id, user_role, recipient_entity_id, delivered, created_at)
       VALUES ($1, $2, $3, $4, true, $5::timestamp)`,
      [notificationId, row.user_id, row.user_role, row.recipient_entity_id, now]
    );
    nodes++;
  }

  return {
    eventId,
    title: created.title,
    link,
    targetRole,
    notificationId,
    primary: primaryIds.length,
    vc: vcIds.length,
    students: studentIds.length,
    nodes,
  };
}

async function main() {
  await ensureStatusColumn();

  const vcCount = (await getUserIdsByRoles(['vc'])).length;
  const alumniCount = (await getUserIdsByRoles(['alumni'])).length;
  const companyCount = (await getUserIdsByRoles(['company'])).length;
  const studentCount = (await getEligibleStudentUserIds()).length;

  console.log('Recipients in DB:', { alumni: alumniCount, company: companyCount, vc: vcCount, eligibleStudents: studentCount });
  console.log('');

  const results = [];
  for (const ev of [...ALUMNI_EVENTS, ...COMPANY_EVENTS]) {
    const r = await createEventWithInvites(ev);
    results.push(r);
    console.log(
      `[${r.targetRole}] Event #${r.eventId}: ${r.title}\n` +
        `  link: ${r.link}\n` +
        `  invited: ${r.primary} ${r.targetRole} + ${r.vc} vc + ${r.students} students → ${r.nodes} notification nodes`
    );
  }

  const alumniEventLinks = await pool.query(
    `SELECT COUNT(DISTINCT (regexp_match(n.link, 'events?[/\\-]([0-9]+)', 'i'))[1])::int AS c
     FROM notifications n
     WHERE n.is_active = true AND n.link IS NOT NULL
       AND ((n.target_type = 'ROLE' AND n.target_role ILIKE '%alumni%') OR n.target_type = 'ALL')`
  );
  console.log('\nAlumni events page (distinct event links):', alumniEventLinks.rows[0].c);
  console.log('Done. Created', results.length, 'events.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
