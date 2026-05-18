require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

async function bulkOptIn() {
  const client = await pool.connect();
  try {
    console.log('Starting bulk opt-in process...');

    // 1. Identify SOCSE school ID
    const schoolRes = await client.query("SELECT id FROM schools WHERE abbreviation = 'SOCSE' OR name ILIKE '%Computer Science%' LIMIT 1");
    const socseId = schoolRes.rows[0]?.id;
    console.log(`SOCSE School ID: ${socseId || 'Not found'}`);

    // 2. Identify BSc program IDs
    const programRes = await client.query("SELECT id, name FROM programs WHERE name ILIKE '%B.Sc%' OR name ILIKE '%BSc%'");
    const bscIds = programRes.rows.map(r => r.id);
    console.log(`BSc Program IDs: ${bscIds.join(', ') || 'None'}`);

    // 3. Find all students who are eligible for placement based on batch policies OR individual flags
    // We join with batch_academic_policies to check batch-level eligibility
    const eligibleQuery = `
      SELECT s.usn, s.full_name, s.school_id, s.program_id, s.year_of_joining
      FROM student_basic_details s
      LEFT JOIN batch_academic_policies p 
        ON s.school_id = p.school_id 
        AND s.program_id = p.program_id 
        AND s.year_of_joining = p.joining_year
      WHERE 
        (p.placement = true OR p.capstone = true OR s.is_placement_eligible = true OR s.is_capstone_eligible = true)
        AND s.opt_in = false
    `;
    
    const eligibleRes = await client.query(eligibleQuery);
    const eligibleStudents = eligibleRes.rows;
    console.log(`Found ${eligibleStudents.length} eligible students not yet opted-in.`);

    if (eligibleStudents.length === 0) {
      console.log('No new eligible students to opt-in.');
      return;
    }

    // 4. Filter for SOCSE BSc students (they get priority/100% opt-in)
    const socseBscStudents = eligibleStudents.filter(s => 
      s.school_id === socseId && bscIds.includes(s.program_id)
    );
    console.log(`SOCSE BSc students found: ${socseBscStudents.length}`);

    // 5. Calculate how many to opt-in to reach ~97% target
    // We'll opt-in ALL SOCSE BSc students, and then a large portion of others.
    const targetPercentage = 0.97;
    const totalToOptIn = Math.floor(eligibleStudents.length * targetPercentage);
    
    // Sort so SOCSE BSc come first
    const sortedStudents = [...eligibleStudents].sort((a, b) => {
      const aIsSocseBsc = a.school_id === socseId && bscIds.includes(a.program_id);
      const bIsSocseBsc = b.school_id === socseId && bscIds.includes(b.program_id);
      if (aIsSocseBsc && !bIsSocseBsc) return -1;
      if (!aIsSocseBsc && bIsSocseBsc) return 1;
      return 0;
    });

    const studentsToProcess = sortedStudents.slice(0, totalToOptIn);
    const usnsToOptIn = studentsToProcess.map(s => s.usn);

    if (usnsToOptIn.length > 0) {
      console.log(`Opting in ${usnsToOptIn.length} students...`);
      const updateQuery = `
        UPDATE student_basic_details 
        SET opt_in = true, has_agreed_placement_policy = true 
        WHERE usn = ANY($1)
      `;
      await client.query(updateQuery, [usnsToOptIn]);
      console.log('Successfully updated records.');
    }

    // Summary
    const finalCountRes = await client.query("SELECT count(*) FROM student_basic_details WHERE opt_in = true");
    console.log(`Total students now opted-in: ${finalCountRes.rows[0].count}`);

  } catch (err) {
    console.error('Error during bulk opt-in:', err);
  } finally {
    client.release();
    pool.end();
  }
}

bulkOptIn();
