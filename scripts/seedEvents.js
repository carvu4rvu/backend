/**
 * Seed script: inserts sample events (with images) into the events table.
 * Run from backend: node scripts/seedEvents.js
 * Requires .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Run migration ensureEventsStatusColumn first (or start server once) so status column exists.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');

const EVENTS = [
  {
    title: 'Tech Talk: AI & ML in Industry',
    type: 'Workshop',
    details: 'Join us for an interactive session on practical applications of AI and Machine Learning in industry. Speakers from leading tech companies.',
    event_datetime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    images: ['https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800', 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800'],
    status: 'scheduled',
  },
  {
    title: 'Placement Prep Bootcamp',
    type: 'Training',
    details: 'Intensive bootcamp covering resume building, coding rounds, and interview skills. Mock interviews included.',
    event_datetime: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    images: ['https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=800'],
    status: 'scheduled',
  },
  {
    title: 'Annual Career Fair 2025',
    type: 'Career Fair',
    details: 'Meet recruiters from 50+ companies. Bring your resume and dress formal. Registrations mandatory.',
    event_datetime: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
    images: ['https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800', 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=800'],
    status: 'scheduled',
  },
  {
    title: 'Hackathon: Build for Campus',
    type: 'Hackathon',
    details: '48-hour hackathon. Themes: EdTech, HealthTech, FinTech. Prizes and mentorship from industry experts.',
    event_datetime: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    images: ['https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800'],
    status: 'completed',
  },
  {
    title: 'Resume Review Workshop',
    type: 'Workshop',
    details: 'Get your resume reviewed by T&P cell. One-on-one slots. First-come first-served.',
    event_datetime: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    images: ['https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=800'],
    status: 'completed',
  },
  {
    title: 'Startup Networking Mixer',
    type: 'Networking',
    details: 'Informal mixer with founders and investors. Light refreshments. Limited slots.',
    event_datetime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    images: ['https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=800'],
    status: 'scheduled',
  },
  {
    title: 'Campus Drive – TCS (Cancelled)',
    type: 'Placement',
    details: 'TCS campus drive postponed due to unforeseen circumstances. New date TBA.',
    event_datetime: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    images: ['https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=800'],
    status: 'failed',
  },
  {
    title: 'Mock GD & Interview Day',
    type: 'Training',
    details: 'Group discussion and HR round mocks. Feedback from alumni and T&P coordinators.',
    event_datetime: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
    images: ['https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=800'],
    status: 'scheduled',
  },
  {
    title: 'Coding Contest – Week of Code',
    type: 'Contest',
    details: 'Three-day competitive coding event. Prizes for top performers. All years welcome.',
    event_datetime: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    images: ['https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=800'],
    status: 'ongoing',
  },
];

async function seed() {
  console.log('Seeding events...');
  for (const e of EVENTS) {
    const { data, error } = await supabase
      .from('events')
      .insert({
        title: e.title,
        type: e.type,
        details: e.details || null,
        event_datetime: e.event_datetime || null,
        images: e.images || [],
        attachments: [],
        status: e.status || 'scheduled',
      })
      .select('id, title, status')
      .single();
    if (error) {
      console.error('Insert error:', e.title, error.message);
      continue;
    }
    console.log('Inserted:', data.id, data.title, data.status);
  }
  console.log('Events seed done.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
