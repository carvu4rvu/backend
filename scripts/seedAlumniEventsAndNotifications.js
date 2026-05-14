/**
 * Seed: Create 3 events (alumni-focused) and send notifications to all alumni for each event.
 * - Inserts 3 events into events table (Supabase).
 * - Inserts 3 notifications (target ROLE alumni) with link to each event.
 * - Creates notification_nodes for every user with role 'alumni'.
 * Run from backend: node scripts/seedAlumniEventsAndNotifications.js
 * Requires: .env with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL (for notifications).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');
const pool = require('../config/db');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const ALUMNI_EVENTS = [
  {
    title: 'Alumni Meet 2025 – Campus Connect',
    type: 'Networking',
    details: 'Annual alumni meet. Connect with batchmates, faculty, and current students. Dinner and campus tour.',
    event_datetime: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'scheduled',
  },
  {
    title: 'Alumni Talk: Industry Insights',
    type: 'Workshop',
    details: 'Alumni from tech and finance share career journeys and tips. Q&A and networking.',
    event_datetime: new Date(Date.now() + 17 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'scheduled',
  },
  {
    title: 'Placement Support – Alumni Mentorship',
    type: 'Mentorship',
    details: 'Alumni mentors available for resume reviews and mock interviews. Sign up via placement cell.',
    event_datetime: new Date(Date.now() + 24 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'scheduled',
  },
];

async function seed() {
  console.log('Seeding alumni events and notifications...\n');

  const eventIds = [];

  for (const e of ALUMNI_EVENTS) {
    const { data: ev, error: evErr } = await supabase
      .from('events')
      .insert({
        title: e.title,
        type: e.type,
        details: e.details || null,
        event_datetime: e.event_datetime || null,
        images: [],
        attachments: [],
        status: e.status || 'scheduled',
      })
      .select('id, title')
      .single();
    if (evErr) {
      console.error('Event insert error:', e.title, evErr.message);
      continue;
    }
    eventIds.push(ev.id);
    console.log('Event created:', ev.id, ev.title);
  }

  if (eventIds.length === 0) {
    console.error('No events created. Exiting.');
    process.exit(1);
  }

  const alumniUserIds = await pool.query(
    `SELECT ul.id FROM user_login ul
     JOIN roles r ON r.id = ul.role_id
     WHERE LOWER(r.name) = 'alumni' AND ul.is_active = true`
  );
  const userIds = (alumniUserIds.rows || []).map((r) => r.id);
  console.log('Alumni user_login ids:', userIds.length);

  if (userIds.length === 0) {
    console.warn('No alumni users found. Notifications will have no recipients. Create alumni users (e.g. run seedAlumni and ensure they have user_login with role alumni).');
  }

  for (let i = 0; i < eventIds.length; i++) {
    const eventId = eventIds[i];
    const ev = ALUMNI_EVENTS[i];
    const link = `${FRONTEND_URL}/events/${eventId}`;
    const notifRes = await pool.query(
      `INSERT INTO notifications (title, message, link, target_type, target_role, is_active, notification_type)
       VALUES ($1, $2, $3, 'ROLE', 'alumni', true, 'EVENT')
       RETURNING id, title`,
      [
        ev.title,
        ev.details || 'Event for alumni. Check the Events page for details.',
        link,
      ]
    );
    if (notifRes.rows.length === 0) continue;
    const notifId = notifRes.rows[0].id;
    console.log('Notification created:', notifId, notifRes.rows[0].title);

    for (const uid of userIds) {
      await pool.query(
        `INSERT INTO notification_nodes (notification_id, user_id, delivered, created_at)
         VALUES ($1, $2, true, NOW())`,
        [notifId, uid]
      );
    }
    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS c FROM notification_nodes WHERE notification_id = $1',
      [notifId]
    );
    console.log('  -> nodes created:', countRes.rows[0].c);
  }

  console.log('\nAlumni events + notifications seed done.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
