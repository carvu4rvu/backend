const pool = require('../config/db');

const ensureEventsStatusColumn = async () => {
  try {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'status'
    `);
    if (res.rows.length === 0) {
      await pool.query(`
        ALTER TABLE public.events
        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scheduled'
      `);
      console.log('Added status column to events');
    }
  } catch (err) {
    console.warn('ensureEventsStatusColumn:', err.message);
  }
};

module.exports = ensureEventsStatusColumn;
