/**
 * Migration: Change projects visibility from LINK_ONLY to PUBLIC_LINK.
 * - Updates existing LINK_ONLY rows to PUBLIC_LINK
 * - Drops old CHECK constraint and adds new one with PUBLIC_LINK
 */
const pool = require('../config/db');

const ensureProjectsVisibilityPublicLink = async () => {
  try {
    const client = await pool.connect();
    try {
      // 1. Update existing data
      await client.query(`
        UPDATE projects SET visibility = 'PUBLIC_LINK' WHERE visibility = 'LINK_ONLY'
      `);

      // 2. Find and drop visibility check constraint
      const constraints = await client.query(`
        SELECT conname FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'projects' AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%visibility%'
      `);
      for (const row of (constraints.rows || [])) {
        await client.query(`ALTER TABLE projects DROP CONSTRAINT IF EXISTS ${row.conname}`);
      }

      // 3. Add new constraint
      try {
        await client.query(`
          ALTER TABLE projects ADD CONSTRAINT projects_visibility_check
          CHECK (visibility = ANY (ARRAY['PRIVATE'::text, 'PUBLIC'::text, 'PUBLIC_LINK'::text]))
        `);
      } catch (addErr) {
        if (!addErr.message || !addErr.message.includes('already exists')) {
          throw addErr;
        }
      }
    } catch (err) {
      console.warn('ensureProjectsVisibilityPublicLink:', err.message);
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn('ensureProjectsVisibilityPublicLink:', err.message);
  }
};

module.exports = ensureProjectsVisibilityPublicLink;
