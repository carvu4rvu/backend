require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

async function fillNullContactDetails() {
  const client = await pool.connect();
  try {
    console.log('[CONTACT UPDATER] Starting update for students with missing contact info...');
    
    // Fetch students where personal_email, phone_number or phone_country_code is null or empty
    const { rows: students } = await client.query(`
      SELECT usn, full_name, college_email, personal_email, phone_country_code, phone_number
      FROM student_basic_details
      WHERE personal_email IS NULL OR personal_email = ''
         OR phone_number IS NULL OR phone_number = ''
         OR phone_country_code IS NULL OR phone_country_code = ''
    `);

    console.log(`[CONTACT UPDATER] Found ${students.length} students with missing contact info.`);
    let updatedCount = 0;

    for (let i = 0; i < students.length; i += 100) {
      const batch = students.slice(i, i + 100);
      await client.query('BEGIN');
      try {
        let batchCount = 0;
        for (const student of batch) {
          const updates = {};
          
          // 1. Fill personal_email if missing
          if (!student.personal_email || student.personal_email.trim() === '') {
            const namePart = student.full_name.toLowerCase().replace(/\s+/g, '.');
            const randomSuffix = Math.floor(Math.random() * 1000);
            updates.personal_email = `${namePart}${randomSuffix}@gmail.com`;
          }

          // 2. Fill phone_country_code if missing
          if (!student.phone_country_code || student.phone_country_code.trim() === '') {
            updates.phone_country_code = '+91';
          }

          // 3. Fill phone_number if missing (must be exactly 10 digits as per constraint)
          if (!student.phone_number || student.phone_number.trim() === '') {
            // Generate a random 10-digit number starting with 6, 7, 8, or 9
            const start = ['6', '7', '8', '9'][Math.floor(Math.random() * 4)];
            let rest = '';
            for (let j = 0; j < 9; j++) {
              rest += Math.floor(Math.random() * 10);
            }
            updates.phone_number = start + rest;
          }

          if (Object.keys(updates).length > 0) {
            const setClause = Object.keys(updates)
              .map((key, idx) => `${key} = $${idx + 1}`)
              .join(', ');
            const values = Object.values(updates);
            values.push(student.usn);

            await client.query(
              `UPDATE student_basic_details SET ${setClause}, updated_at = NOW() WHERE usn = $${values.length}`,
              values
            );
            batchCount++;
          }
        }
        await client.query('COMMIT');
        updatedCount += batchCount;
        console.log(`[CONTACT UPDATER] Updated batch. Total updated so far: ${updatedCount}`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`Error in batch starting index ${i}:`, e);
      }
    }

    console.log(`[CONTACT UPDATER] Successfully completed. Total records filled: ${updatedCount}`);
    
  } catch (error) {
    console.error('[CONTACT UPDATER] Fatal Error:', error);
  } finally {
    client.release();
    process.exit(0);
  }
}

fillNullContactDetails();
