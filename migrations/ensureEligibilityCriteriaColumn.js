const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

/**
 * Ensures placements_drives.eligibility_criteria exists and migrates legacy
 * placement_drive_eligibility rows when present.
 */
const ensureEligibilityCriteriaColumn = async () => {
  try {
    const colRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'placements_drives'
        AND column_name = 'eligibility_criteria'
    `);
    if (colRes.rows.length === 0) {
      const sqlPath = path.join(__dirname, 'migrate_eligibility_to_drives.sql');
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await pool.query(sql);
      console.log('ensureEligibilityCriteriaColumn: added eligibility_criteria and migrated legacy data');
    }
  } catch (err) {
    console.warn('ensureEligibilityCriteriaColumn:', err.message);
  }
};

module.exports = ensureEligibilityCriteriaColumn;
