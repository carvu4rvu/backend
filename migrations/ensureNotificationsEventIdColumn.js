const pool = require('../config/db');

const ensureNotificationsEventIdColumn = async () => {
  try {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'event_id'
    `);
    if (res.rows.length === 0) {
      await pool.query(`
        ALTER TABLE public.notifications
        ADD COLUMN IF NOT EXISTS event_id integer REFERENCES public.events(id) ON DELETE SET NULL
      `);
      console.log('Added event_id column to notifications');
    }
  } catch (err) {
    console.warn('ensureNotificationsEventIdColumn:', err.message);
  }
};

module.exports = ensureNotificationsEventIdColumn;
