require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const LOGIN_PASSWORD = '123123';
const BATCHES = [2022, 2023, 2024, 2025];

const FIRST_NAMES_MALE = [
  'Arnav', 'Vihaan', 'Advait', 'Aryan', 'Aarav', 'Reyansh', 'Vivaan', 'Kabir', 'Ayaan', 'Ishaan',
  'Atharv', 'Shaurya', 'Dev', 'Karan', 'Nikhil', 'Yash', 'Alok', 'Parth', 'Ojas', 'Rahul',
  'Sagar', 'Tarun', 'Umesh', 'Varun', 'Vikram', 'Vinay', 'Vivek', 'Yuvraj', 'Amit', 'Anil'
];

const FIRST_NAMES_FEMALE = [
  'Aadhya', 'Saanvi', 'Ananya', 'Diya', 'Kiara', 'Myra', 'Navya', 'Ira', 'Riya', 'Kavya',
  'Avni', 'Ishita', 'Anika', 'Zoya', 'Kyra', 'Sia', 'Vanya', 'Shanaya', 'Meera', 'Tara',
  'Aditi', 'Esha', 'Ishani', 'Jhanvi', 'Kriti', 'Prisha', 'Tanya', 'Zara', 'Bhavya', 'Chitra'
];

const LAST_NAMES = [
  'Agarwal', 'Bansal', 'Chopra', 'Das', 'Gupta', 'Iyer', 'Jha', 'Kapoor', 'Luthra', 'Malhotra',
  'Nanda', 'Oza', 'Puri', 'Rao', 'Sharma', 'Tiwari', 'Upadhyay', 'Verma', 'Wadhwa', 'Yadav',
  'Zaveri', 'Bhasin', 'Chawla', 'Dixit', 'Grover', 'Handa', 'Inamdar', 'Johar', 'Khurana', 'Lamba',
  'Madan', 'Nigam', 'Oberoi', 'Pradhan', 'Rastogi', 'Sareen', 'Taneja', 'Unnikrishnan', 'Vasudevan', 'Warrier',
  'Bakshi', 'Chaturvedi', 'Dhar', 'Gadgil', 'Hirani', 'Irani', 'Jadeja', 'Kanwar', 'Mahajan', 'Nagpal'
];

const PROGRAM_CODE_MAP = {
  'BTech H': 'BTECH',
  'BSc H': 'BSC',
  'BCA': 'BCA',
  'BBA (Hons)': 'BBA',
  'BCom (Hons)': 'BCOM',
  'BALLB (Hons)': 'BALLB',
  'BBA LLB': 'BBALLB',
  'BDes H': 'BDES',
  'MDes': 'MDES',
  'BA (Hons)': 'BA',
  'BSc (Hons)': 'BSC'
};

const ACADEMIC_DATA = {
  "schools": [
    {"id": "12", "name": "SoCSE"},
    {"id": "13", "name": "SoL"},
    {"id": "14", "name": "SoDI"},
    {"id": "15", "name": "SoB"},
    {"id": "16", "name": "SoFMCA"},
    {"id": "17", "name": "SoLAS"},
    {"id": "18", "name": "SoEPP"}
  ],
  "programs": [
    {"id": "26", "name": "BSc H", "school_id": "12"},
    {"id": "27", "name": "BTech H", "school_id": "12"},
    {"id": "28", "name": "BCA", "school_id": "12"},
    {"id": "31", "name": "BALLB (Hons)", "school_id": "13"},
    {"id": "32", "name": "BBA LLB", "school_id": "13"},
    {"id": "33", "name": "BDes H", "school_id": "14"},
    {"id": "34", "name": "MDes", "school_id": "14"},
    {"id": "35", "name": "BBA (Hons)", "school_id": "15"},
    {"id": "36", "name": "BCom (Hons)", "school_id": "15"},
    {"id": "38", "name": "BA (Hons)", "school_id": "16"},
    {"id": "37", "name": "BSc (Hons)", "school_id": "16"},
    {"id": "39", "name": "BA (Hons)", "school_id": "17"},
    {"id": "41", "name": "BSc (Hons)", "school_id": "17"},
    {"id": "42", "name": "BSc (Hons)", "school_id": "18"},
    {"id": "43", "name": "BA (Hons)", "school_id": "18"}
  ]
};

async function getAcademicDetails(client) {
  const majors = await client.query("SELECT id, program_id FROM majors");
  const minors = await client.query("SELECT id, school_id FROM minors");
  const specs = await client.query("SELECT id, program_id FROM specializations");

  const majorsMap = {};
  majors.rows.forEach(m => {
    if (!majorsMap[m.program_id]) majorsMap[m.program_id] = [];
    majorsMap[m.program_id].push(m.id);
  });

  const minorsMap = {};
  minors.rows.forEach(m => {
    if (!minorsMap[m.school_id]) minorsMap[m.school_id] = [];
    minorsMap[m.school_id].push(m.id);
  });

  const specsMap = {};
  specs.rows.forEach(s => {
    if (!specsMap[s.program_id]) specsMap[s.program_id] = [];
    specsMap[s.program_id].push(s.id);
  });

  return { majorsMap, minorsMap, specsMap };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getUsnCode(programName) {
  return PROGRAM_CODE_MAP[programName] || 'RVU';
}

async function getOrCreateStudentRole(client) {
  let role = await client.query(`SELECT id FROM roles WHERE lower(name) = 'student' LIMIT 1`);
  if (role.rows.length > 0) return role.rows[0].id;
  await client.query(`INSERT INTO roles (name) VALUES ('student') ON CONFLICT ((lower(name))) DO NOTHING`);
  role = await client.query(`SELECT id FROM roles WHERE lower(name) = 'student' LIMIT 1`);
  return role.rows[0].id;
}

async function bulkSeed() {
  console.log('Starting bulk seeding for all remaining programs...\n');
  const client = await pool.connect();
  try {
    const { majorsMap, minorsMap, specsMap } = await getAcademicDetails(client);
    const roleId = await getOrCreateStudentRole(client);
    const passwordHash = await bcrypt.hash(LOGIN_PASSWORD, 10);

    for (const program of ACADEMIC_DATA.programs) {
      console.log(`Processing Program: ${program.name} (School: ${program.school_id})...`);
      const usnCode = getUsnCode(program.name);
      
      for (const batch of BATCHES) {
        // Skip SoCSE BTech/BSc 2023-2025 as they were already seeded specifically
        if (program.school_id === '12' && (program.name === 'BTech H' || program.name === 'BSc H') && batch >= 2023) {
          continue;
        }

        const count = Math.floor(Math.random() * (60 - 30 + 1)) + 30;
        console.log(`  Batch ${batch}: Seeding ${count} students...`);

        for (let i = 1; i <= count; i++) {
          const gender = i % 2 === 0 ? 'Female' : 'Male';
          const firstName = gender === 'Male' ? pickRandom(FIRST_NAMES_MALE) : pickRandom(FIRST_NAMES_FEMALE);
          const lastName = pickRandom(LAST_NAMES);
          const fullName = `${firstName} ${lastName}`;
          
          const usnPrefix = (program.name === 'BTech H' || program.name === 'BSc H') ? '1RUA' : '1RVU';
          const usn = `${usnPrefix}${String(batch).slice(-2)}${usnCode}${String(i).padStart(3, '0')}`;
          
          const emailProgramPart = usnCode.toLowerCase();
          const email = `${firstName.toLowerCase()}${lastName.toLowerCase()}.${emailProgramPart}${String(batch).slice(-2)}${i}@rvu.edu.in`;
          const personalEmail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${batch}${i}@gmail.com`;

          const majorId = majorsMap[program.id] ? pickRandom(majorsMap[program.id]) : null;
          const minorId = minorsMap[program.school_id] ? pickRandom(minorsMap[program.school_id]) : null;
          const specId = specsMap[program.id] ? pickRandom(specsMap[program.id]) : null;

          // Placement eligibility rules: 2022/2023 batch active, 2024/2025 inactive
          const isEligible = batch <= 2023;
          
          const phone = `9${Math.floor(Math.random() * 900000000 + 100000000)}`;
          const dobYear = batch - 18;
          const dob = `${dobYear}-${String(Math.floor(Math.random()*12)+1).padStart(2,'0')}-${String(Math.floor(Math.random()*28)+1).padStart(2,'0')}`;

          await client.query('BEGIN');
          try {
            await client.query(
              `INSERT INTO student_basic_details (
                usn, full_name, college_email, personal_email,
                school_id, program_id, major_id, minor_id, specialization_id,
                year_of_joining, current_year, current_semester, section,
                gender, date_of_birth, phone_country_code, phone_number, is_registered,
                opt_in, has_agreed_placement_policy, is_placement_eligible
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, '+91', $16, true, $17, $17, $17)
              ON CONFLICT (usn) DO NOTHING`,
              [
                usn, fullName, email, personalEmail,
                program.school_id, program.id, majorId, minorId, specId,
                batch, (2026 - batch), (2026 - batch) * 2, i <= 30 ? 'A' : 'B',
                gender, dob, phone, isEligible
              ]
            );

            await client.query(
              `INSERT INTO user_login (usn, role_id, password_hash, email_id, is_active)
               VALUES ($1, $2, $3, $4, true)
               ON CONFLICT (usn) DO NOTHING`,
              [usn, roleId, passwordHash, email]
            );

            await client.query(
              `INSERT INTO student_profile_details (usn, brief_summary, updated_at)
               VALUES ($1, $2, NOW())
               ON CONFLICT (usn) DO NOTHING`,
              [usn, `Student from ${program.name}, ${batch} batch.`]
            );

            await client.query('COMMIT');
          } catch (e) {
            await client.query('ROLLBACK');
            throw e;
          }
        }
      }
    }
    console.log('\nBulk seeding completed successfully.');
  } catch (e) {
    console.error('Error during bulk seeding:', e);
  } finally {
    client.release();
    process.exit(0);
  }
}

bulkSeed();
