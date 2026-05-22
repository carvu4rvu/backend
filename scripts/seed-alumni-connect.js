require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const alumniDb = require('../db/alumniDb');

(async () => {
  try {
    const existing = await alumniDb.getConnectionRequests(null);
    if (existing.length > 0) {
      console.log('Already has', existing.length, 'request(s); skipping seed.');
      process.exit(0);
    }

    const row = await alumniDb.insertConnectionRequest({
      alumni_id: 25,
      student_usn: '1RUA22BSC003',
      connection_purpose: 'Career guidance and internship referral',
      message_to_po:
        'I would like to connect with this student to share industry experience and explore internship opportunities at my company.',
      preferred_contact_date: '2026-05-25',
      preferred_time_slot: '10:00 AM - 12:00 PM',
      contact_mode: 'Email',
      status: 'PENDING',
    });

    console.log('Seeded connection request:', JSON.stringify(row, null, 2));
  } catch (e) {
    console.error('Seed failed:', e.message);
    process.exit(1);
  } finally {
    const pool = require('../config/db');
    await pool.end();
  }
})();
