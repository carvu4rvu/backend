require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const LANGUAGES_LIST = ['English', 'Hindi', 'Kannada', 'Tamil', 'Telugu', 'Marathi', 'Malayalam', 'Bengali', 'Gujarati'];
const SECTIONS = ['A', 'B', 'C'];

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomLanguages() {
  const count = Math.floor(Math.random() * 3) + 2; // 2 to 4 languages
  const selected = new Set(['English']); // Everyone knows English
  while (selected.size < count) {
    selected.add(pickRandom(LANGUAGES_LIST));
  }
  return Array.from(selected).join(', ');
}

async function updatePersonalDetails() {
  console.log('[PERSONAL UPDATER] Starting update for all students...');
  const client = await pool.connect();
  try {
    // 1. Fetch academic lookup data
    const { rows: majors } = await client.query('SELECT id, program_id FROM majors');
    const { rows: specs } = await client.query('SELECT id, program_id FROM specializations');
    const { rows: minors } = await client.query('SELECT id FROM minors');

    const majorsByProgram = {};
    majors.forEach(m => {
      if (!majorsByProgram[m.program_id]) majorsByProgram[m.program_id] = [];
      majorsByProgram[m.program_id].push(m.id);
    });

    const specsByProgram = {};
    specs.forEach(s => {
      if (!specsByProgram[s.program_id]) specsByProgram[s.program_id] = [];
      specsByProgram[s.program_id].push(s.id);
    });

    const allMinorIds = minors.map(m => m.id);

    // 2. Fetch all students
    const { rows: students } = await client.query(`
      SELECT usn, year_of_joining, date_of_birth, blood_group, languages, school_id, program_id, major_id, specialization_id, minor_id, section, current_semester, specially_abled
      FROM student_basic_details
    `);

    console.log(`[PERSONAL UPDATER] Processing ${students.length} students.`);
    let updatedCount = 0;

    // Distribute sections equally across the whole student population per program
    const programSectionCounters = {};

    for (let i = 0; i < students.length; i += 100) {
      const batch = students.slice(i, i + 100);
      await client.query('BEGIN');
      try {
        let batchCount = 0;
        for (const student of batch) {
          // Blood Group
          const bloodGroup = student.blood_group || pickRandom(BLOOD_GROUPS);
          
          // Languages
          const languages = student.languages || getRandomLanguages();
          
          // DOB
          let dob = student.date_of_birth;
          if (!dob) {
            const joiningBatch = student.year_of_joining || 2023;
            const dobYear = joiningBatch - 18;
            dob = `${dobYear}-${String(Math.floor(Math.random()*12)+1).padStart(2,'0')}-${String(Math.floor(Math.random()*28)+1).padStart(2,'0')}`;
          }

          // Specially Abled: 0.5% Yes, rest No
          const speciallyAbled = Math.random() < 0.005;

          // Section distribution (max 3 sections: A, B, C)
          if (!programSectionCounters[student.program_id]) {
            programSectionCounters[student.program_id] = 0;
          }
          const section = SECTIONS[programSectionCounters[student.program_id] % 3];
          programSectionCounters[student.program_id]++;

          // Semester check (assuming May 2026 is even semester)
          const currentYear = 2026;
          const yoj = student.year_of_joining || 2023;
          const semester = (currentYear - yoj) * 2;
          const academicYear = Math.ceil(semester / 2);

          // Major and Specialization from the same program
          const programId = student.program_id;
          const majorId = pickRandom(majorsByProgram[programId]) || student.major_id;
          const specializationId = pickRandom(specsByProgram[programId]) || student.specialization_id;
          
          // Minor from any school
          const minorId = pickRandom(allMinorIds) || student.minor_id;

          await client.query(
            `UPDATE student_basic_details 
             SET blood_group = $1, 
                 languages = $2, 
                 date_of_birth = $3, 
                 specially_abled = $4,
                 section = $5,
                 current_semester = $6,
                 current_year = $7,
                 major_id = $8,
                 specialization_id = $9,
                 minor_id = $10
             WHERE usn = $11`,
            [bloodGroup, languages, dob, speciallyAbled, section, semester, academicYear, majorId, specializationId, minorId, student.usn]
          );
          batchCount++;
        }
        await client.query('COMMIT');
        updatedCount += batchCount;
        console.log(`[PERSONAL UPDATER] Updated ${updatedCount} students...`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`Error in batch starting at index ${i}:`, e);
      }
    }

    console.log(`[PERSONAL UPDATER] Successfully completed. Total updated: ${updatedCount}`);
    
  } catch (error) {
    console.error('[PERSONAL UPDATER] Fatal Error:', error);
  } finally {
    client.release();
    process.exit(0);
  }
}

updatePersonalDetails();
