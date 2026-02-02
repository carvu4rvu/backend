const pool = require('../config/db');

const ensureNotificationsDriveIdColumn = async () => {
  try {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'drive_id'
    `);
    if (res.rows.length === 0) {
      await pool.query(`
        ALTER TABLE public.notifications
        ADD COLUMN IF NOT EXISTS drive_id integer REFERENCES public.placements_drives(id) ON DELETE SET NULL
      `);
      console.log('Added drive_id column to notifications');
    }
  } catch (err) {
    console.warn('ensureNotificationsDriveIdColumn:', err.message);
  }
};

module.exports = ensureNotificationsDriveIdColumn;
