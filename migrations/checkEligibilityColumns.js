/**
 * Migration: Ensure eligibility columns exist on student_basic_details
 * Columns: is_summer_immersion_eligible, is_summer_internship_eligible, is_capstone_eligible, is_placement_eligible
 */
const pool = require('../config/db');

async function ensureEligibilityColumns() {
  const client = await pool.connect();
  try {
    const columnsToAdd = [
      'is_summer_immersion_eligible',
      'is_summer_internship_eligible',
      'is_capstone_eligible',
      'is_placement_eligible'
    ];

    for (const colName of columnsToAdd) {
      const result = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'student_basic_details' AND column_name = $1
      `, [colName]);

      if (result.rows.length === 0) {
        await client.query(`
          ALTER TABLE student_basic_details 
          ADD COLUMN ${colName} boolean NOT NULL DEFAULT false
        `);
        console.log(`Added ${colName} column`);
      } else {
        console.log(`Column ${colName} already exists`);
      }
    }

    console.log('Eligibility columns check complete');
  } catch (err) {
    console.error('Error ensuring eligibility columns:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = ensureEligibilityColumns;

// Run directly if executed as script
if (require.main === module) {
  ensureEligibilityColumns()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
