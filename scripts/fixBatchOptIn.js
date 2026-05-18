require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

async function fixBatchOptIn() {
  const client = await pool.connect();
  try {
    console.log('Resetting and fixing opt-in states based on batch years (2022 & 2023 only)...');

    // 1. Opt-IN students from 2022 and 2023 batches
    const optInRes = await client.query(`
      UPDATE student_basic_details 
      SET 
        opt_in = true, 
        has_agreed_placement_policy = true,
        is_placement_eligible = true,
        is_capstone_eligible = true
      WHERE year_of_joining IN (2022, 2023)
      RETURNING usn
    `);
    console.log(`Successfully opted-in ${optInRes.rowCount} students from 2022 and 2023 batches.`);

    // 2. Opt-OUT students from all other batches
    const optOutRes = await client.query(`
      UPDATE student_basic_details 
      SET 
        opt_in = false, 
        has_agreed_placement_policy = false,
        is_placement_eligible = false,
        is_capstone_eligible = false
      WHERE year_of_joining NOT IN (2022, 2023) OR year_of_joining IS NULL
      RETURNING usn
    `);
    console.log(`Successfully opted-out ${optOutRes.rowCount} students from other batches.`);

    // 3. Update Batch Academic Policies to match
    // Set placement and capstone to true for 2022/2023, false for others
    await client.query(`
      UPDATE batch_academic_policies 
      SET placement = true, capstone = true 
      WHERE joining_year IN (2022, 2023)
    `);
    
    await client.query(`
      UPDATE batch_academic_policies 
      SET placement = false, capstone = false 
      WHERE joining_year NOT IN (2022, 2023)
    `);
    console.log('Updated batch academic policies to restrict placement/capstone for non-2022/2023 batches.');

    // 4. Final Summary
    const summaryRes = await client.query(`
      SELECT 
        year_of_joining, 
        count(*) as total,
        count(*) FILTER (WHERE opt_in = true) as opted_in
      FROM student_basic_details 
      GROUP BY year_of_joining 
      ORDER BY year_of_joining DESC
    `);
    console.table(summaryRes.rows);

  } catch (err) {
    console.error('Error during batch fix:', err);
  } finally {
    client.release();
    pool.end();
  }
}

fixBatchOptIn();
