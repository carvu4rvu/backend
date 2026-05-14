/**
 * Upload placeholder images for events to the system-assets bucket.
 * Path: system-assets/events/{eventId}.jpg
 * Run from backend: node scripts/uploadEventImagesToSystemAssets.js
 * Requires: .env with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const supabase = require('../config/supabaseClient');

const BUCKET = 'system-assets';
const FOLDER = 'events';

async function fetchImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function main() {
  const { data: events, error: listError } = await supabase
    .from('events')
    .select('id, title')
    .order('id', { ascending: true });

  if (listError) {
    console.error('Failed to list events:', listError.message);
    process.exit(1);
  }

  if (!events?.length) {
    console.log('No events found. Create events first (e.g. run seedAlumniEventsAndNotifications.js).');
    process.exit(0);
  }

  console.log(`Found ${events.length} event(s). Uploading images to ${BUCKET}/${FOLDER}/...\n`);

  for (const ev of events) {
    const path = `${FOLDER}/${ev.id}.jpg`;
    const placeholderUrl = `https://picsum.photos/800/400?random=${ev.id}`;
    try {
      const buffer = await fetchImage(placeholderUrl);
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });

      if (error) throw error;
      console.log(`  OK ${path} (${ev.title || ev.id})`);
    } catch (err) {
      console.error(`  FAIL ${path}:`, err.message);
    }
  }

  console.log('\nDone. Set VITE_SUPABASE_URL in frontend .env to your Supabase URL so event images load.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
