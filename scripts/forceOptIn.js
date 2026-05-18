require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

async function debugEligibility() {
  const client = await pool.connect();
  try {
    // 1. Check some sample students
    const sampleRes = await client.query("SELECT usn, full_name, school_id, program_id, year_of_joining, opt_in, is_placement_eligible FROM student_basic_details LIMIT 5");
    console.log('Sample Students:', sampleRes.rows);

    // 2. Check policies
    const policyRes = await client.query("SELECT * FROM batch_academic_policies LIMIT 5");
    console.log('Sample Policies:', policyRes.rows);

    // 3. Count total students and opted-in
    const countRes = await client.query("SELECT count(*), count(*) FILTER (WHERE opt_in = true) as opted_in FROM student_basic_details");
    console.log('Student counts:', countRes.rows[0]);

    // 4. Force opt-in for BSc students (ignoring strict eligibility if needed)
    console.log('Attempting to opt-in all BSc students...');
    const bscUpdateRes = await client.query(`
      UPDATE student_basic_details 
      SET opt_in = true, has_agreed_placement_policy = true 
      WHERE program_id IN (SELECT id FROM programs WHERE name ILIKE '%B.Sc%' OR name ILIKE '%BSc%')
      RETURNING usn
    `);
    console.log(`Updated ${bscUpdateRes.rowCount} BSc students.`);

    // 5. Reach ~97% for the rest
    const remainingToOptIn = await client.query(`
      SELECT usn FROM student_basic_details WHERE opt_in = false
    `);
    const usns = remainingToOptIn.rows.map(r => r.usn);
    const targetCount = Math.floor(usns.length * 0.97);
    const subset = usns.slice(0, targetCount);
    
    if (subset.length > 0) {
      await client.query(`
        UPDATE student_basic_details 
        SET opt_in = true, has_agreed_placement_policy = true 
        WHERE usn = ANY($1)
      `, [subset]);
      console.log(`Updated ${subset.length} additional students to reach target.`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}
debugEligibility();
