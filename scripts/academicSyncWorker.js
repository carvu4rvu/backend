require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const { computeCurrentYearSemester } = require('../utils/studentAcademic');

/**
 * Worker function to synchronize student current_year and current_semester 
 * based on their year_of_joining and the current date.
 */
async function syncAllStudentAcademics() {
  console.log('[ACADEMIC WORKER] Starting synchronization...');
  const client = await pool.connect();
  try {
    // 1. Fetch all students with their joining year and program duration
    const { rows: students } = await client.query(`
      SELECT s.usn, s.year_of_joining, p.max_duration_years 
      FROM student_basic_details s
      LEFT JOIN programs p ON s.program_id = p.id
    `);

    console.log(`[ACADEMIC WORKER] Found ${students.length} students to process.`);
    let updatedCount = 0;

    await client.query('BEGIN');

    for (const student of students) {
      const { current_year, current_semester } = computeCurrentYearSemester(
        student.year_of_joining, 
        student.max_duration_years || 4
      );

      // Update the student record
      await client.query(
        `UPDATE student_basic_details 
         SET current_year = $1, current_semester = $2 
         WHERE usn = $3`,
        [current_year, current_semester, student.usn]
      );
      updatedCount++;
    }

    await client.query('COMMIT');
    console.log(`[ACADEMIC WORKER] Successfully updated ${updatedCount} students.`);
    
    // Verification check for 2023 batch
    const { rows: check } = await client.query(`
      SELECT usn, year_of_joining, current_year, current_semester 
      FROM student_basic_details 
      WHERE year_of_joining = 2023 
      LIMIT 1
    `);
    if (check.length > 0) {
      console.log(`[VERIFICATION] 2023 Student Sample: Year ${check[0].current_year}, Sem ${check[0].current_semester}`);
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[ACADEMIC WORKER] Error during synchronization:', error);
  } finally {
    client.release();
  }
}

// If run directly
if (require.main === module) {
  syncAllStudentAcademics().then(() => process.exit(0));
}

module.exports = { syncAllStudentAcademics };
