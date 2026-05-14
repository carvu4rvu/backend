require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const LOGIN_PASSWORD = '123123';
const BATCH = 2025;
const SCHOOL_ID = 12; // SoCSE
const PROGRAM_ID = 26; // BSc H
const PROGRAM_CODE = 'BSC';

const FIRST_NAMES = [
  'Abhay', 'Abhishek', 'Adarsh', 'Akshay', 'Anant', 'Aniruddh', 'Ansh', 'Aradhya', 'Aryan', 'Atharv',
  'Ayushman', 'Bhuvan', 'Daksh', 'Darsh', 'Devansh', 'Dhruva', 'Divyansh', 'Ekansh', 'Hriday', 'Idhant',
  'Ishwar', 'Kabir', 'Kairav', 'Lakshay', 'Manan', 'Mayank', 'Nakul', 'Nirvaan', 'Pranay', 'Pratyush',
  'Ranveer', 'Rishi', 'Rudra', 'Samarth', 'Sarthak', 'Shaurya', 'Shlok', 'Tanmay', 'Udbhav', 'Utkarsh',
  'Vaibhav', 'Vansh', 'Vedant', 'Viaan', 'Viraaj', 'Yug', 'Aaradhya', 'Ananya', 'Avni', 'Drishti',
  'Inaya', 'Jiya', 'Kiara', 'Myra', 'Navya', 'Pari', 'Ridhima', 'Saanvi', 'Shanaya', 'Vanya'
];

const LAST_NAMES = [
  'Agrawal', 'Bakshi', 'Bhatt', 'Biswas', 'Chakraborty', 'Chatterjee', 'Choudhury', 'Dasgupta', 'Dutta', 'Ganguly',
  'Ghosal', 'Goswami', 'Halder', 'Kapur', 'Lahiri', 'Majumdar', 'Mallick', 'Mukherjee', 'Nag', 'Nandi',
  'Pal', 'Pramanik', 'Ray', 'Sanyal', 'Sarkar', 'Sen', 'Sengupta', 'Talukdar', 'Thakur', 'Tripathi',
  'Bandyopadhyay', 'Bhattacharya', 'Bhowmick', 'Ghosh', 'Guha', 'Kundu', 'Maitra', 'Mitra', 'Mondal', 'Poddar',
  'Roy', 'Saha', 'Samanta', 'Shome', 'Sinha', 'Sur', 'Bagchi', 'Banerjee', 'Basu', 'Chandra',
  'Das', 'De', 'Deb', 'Dhar', 'Kar', 'Mazumdar', 'Misra', 'Nath', 'Rakshit', 'Seal'
];

const MAJORS = [34, 39]; // Full Stack, Data Science and AI ML
const MINORS = [17, 18, 19, 20, 21, 22, 23, 24, 25]; // SoCSE Minors
const SPECS = [29, 30, 31, 32]; // BSc H Specs

function pick(arr, index) {
  return arr[index % arr.length];
}

async function getOrCreateStudentRole(client) {
  let role = await client.query(`SELECT id FROM roles WHERE lower(name) = 'student' LIMIT 1`);
  if (role.rows.length > 0) return role.rows[0].id;
  await client.query(`INSERT INTO roles (name) VALUES ('student') ON CONFLICT ((lower(name))) DO NOTHING`);
  role = await client.query(`SELECT id FROM roles WHERE lower(name) = 'student' LIMIT 1`);
  return role.rows[0].id;
}

async function seed60_2025() {
  console.log('Seeding 60 students for SoCSE BSc H 2025 batch (Opt-out)...\n');
  const client = await pool.connect();
  try {
    const roleId = await getOrCreateStudentRole(client);
    const passwordHash = await bcrypt.hash(LOGIN_PASSWORD, 10);

    for (let i = 0; i < 60; i++) {
      const firstName = pick(FIRST_NAMES, i);
      const lastName = pick(LAST_NAMES, i + 15);
      const fullName = `${firstName} ${lastName}`;
      
      const slNo = 301 + i; // Offset to avoid USN collision
      const usn = `1RVU25${PROGRAM_CODE}${slNo}`;
      
      // Email format: name+lastname.bsc25@rvu.edu.in
      const emailLocal = `${firstName.toLowerCase()}${lastName.toLowerCase()}.bsc25`;
      const collegeEmail = `${emailLocal}@rvu.edu.in`;
      const personalEmail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@gmail.com`;
      
      const majorId = pick(MAJORS, i);
      const minorId = pick(MINORS, i);
      const specId = pick(SPECS, i);

      await client.query('BEGIN');
      try {
        // 1. Basic Details (Opt-in false, eligibility false)
        await client.query(
          `INSERT INTO student_basic_details (
            usn, full_name, college_email, personal_email,
            school_id, program_id, major_id, minor_id, specialization_id,
            year_of_joining, current_year, current_semester, section,
            gender, is_registered, phone_country_code, phone_number,
            opt_in, has_agreed_placement_policy, is_placement_eligible
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, '+91', $15, false, false, false)
          ON CONFLICT (usn) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            college_email = EXCLUDED.college_email,
            personal_email = EXCLUDED.personal_email,
            major_id = EXCLUDED.major_id,
            minor_id = EXCLUDED.minor_id,
            specialization_id = EXCLUDED.specialization_id,
            opt_in = false,
            has_agreed_placement_policy = false,
            is_placement_eligible = false`,
          [
            usn, fullName, collegeEmail, personalEmail,
            SCHOOL_ID, PROGRAM_ID, majorId, minorId, specId,
            BATCH, 1, 2, i < 30 ? 'A' : 'B',
            i % 2 === 0 ? 'Female' : 'Male',
            `6${String(100000000 + i * 345678).slice(-9)}`
          ]
        );

        // 2. Login
        await client.query(
          `INSERT INTO user_login (usn, role_id, password_hash, email_id, is_active)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (usn) DO UPDATE SET email_id = EXCLUDED.email_id`,
          [usn, roleId, passwordHash, collegeEmail]
        );

        // 3. Profile Details
        await client.query(
          `INSERT INTO student_profile_details (usn, brief_summary, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (usn) DO UPDATE SET updated_at = NOW()`,
          [usn, `First year student from ${fullName}'s batch.`]
        );

        // 4. Education history
        await client.query(`DELETE FROM student_education_history WHERE usn = $1`, [usn]);
        await client.query(
          `INSERT INTO student_education_history (usn, education_level, institute_name, city, board, start_year, end_year, result, result_type)
           VALUES 
           ($1, '10TH', 'High School', 'Bangalore', 'CBSE', 2020, 2021, '95', 'PERCENTAGE'),
           ($1, '12TH', 'Junior College', 'Bangalore', 'CBSE', 2021, 2023, '90', 'PERCENTAGE')`,
          [usn]
        );

        // 5. Semester records (for 1 semester completed)
        await client.query(`DELETE FROM student_semester_records WHERE usn = $1`, [usn]);
        await client.query(
          `INSERT INTO student_semester_records (usn, academic_year, semester, sgpa, cgpa, cleared_backlogs, active_backlogs, result_file)
           VALUES 
           ($1, 2025, 1, 8.8, 8.8, 0, 0, 'https://example.com/res.pdf')`,
          [usn]
        );

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      if ((i + 1) % 10 === 0) console.log(`Inserted ${i + 1} students...`);
    }
    console.log('\nSuccessfully seeded 60 students for 2025 batch.');
  } catch (e) {
    console.error('Error seeding students:', e);
  } finally {
    client.release();
    process.exit(0);
  }
}

seed60_2025();
