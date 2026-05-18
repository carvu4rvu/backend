require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const LOGIN_PASSWORD = '123123';
const BATCH = 2023;
const SCHOOL_ID = 12; // SoCSE
const PROGRAM_ID = 26; // BSc H
const PROGRAM_CODE = 'BSC';

const FIRST_NAMES = [
  'Aravind', 'Arjun', 'Aditya', 'Akash', 'Anish', 'Ankit', 'Aryan', 'Ayush', 'Bharat', 'Chaitanya',
  'Darshan', 'Deepak', 'Dhruv', 'Ganesh', 'Gautam', 'Harish', 'Ishaan', 'Jatin', 'Karan', 'Kartik',
  'Kiran', 'Kunal', 'Manish', 'Manoj', 'Mohit', 'Naveen', 'Nikhil', 'Nitin', 'Pankaj', 'Pranav',
  'Prateek', 'Rahul', 'Rajesh', 'Rakesh', 'Rohan', 'Rohit', 'Sagar', 'Sandeep', 'Sanjay', 'Saurabh',
  'Shivam', 'Shreyas', 'Siddharth', 'Sumit', 'Suraj', 'Sushant', 'Tarun', 'Uday', 'Varun', 'Vijay',
  'Vikram', 'Vinay', 'Vishal', 'Vivek', 'Yash', 'Ananya', 'Ishita', 'Kavya', 'Pooja', 'Riya'
];

const LAST_NAMES = [
  'Kumar', 'Sharma', 'Singh', 'Patel', 'Gupta', 'Verma', 'Jain', 'Reddy', 'Nair', 'Iyer',
  'Kulkarni', 'Deshpande', 'Joshi', 'Patil', 'Shinde', 'Pawar', 'Yadav', 'Chaudhary', 'Mishra', 'Pandey',
  'Bhardwaj', 'Aggarwal', 'Bansal', 'Goyal', 'Soni', 'Mehta', 'Shah', 'Parekh', 'Vora', 'Thakur',
  'Rao', 'Murthy', 'Hegde', 'Bhat', 'Shetty', 'Rai', 'Prabhu', 'Kamath', 'Menon', 'Pillai',
  'Sinha', 'Srivastava', 'Dubey', 'Tiwari', 'Chatterjee', 'Banerjee', 'Mukherjee', 'Dutta', 'Das', 'Sen',
  'Malhotra', 'Kapoor', 'Khanna', 'Chopra', 'Arora', 'Sethi', 'Malik', 'Gill', 'Sandhu', 'Sidhu'
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

async function seed60() {
  console.log('Seeding 60 students for SoCSE BSc H 2023 batch...\n');
  const client = await pool.connect();
  try {
    const roleId = await getOrCreateStudentRole(client);
    const passwordHash = await bcrypt.hash(LOGIN_PASSWORD, 10);

    for (let i = 0; i < 60; i++) {
      const firstName = pick(FIRST_NAMES, i);
      const lastName = pick(LAST_NAMES, i + 7); // Offset to vary combinations
      const fullName = `${firstName} ${lastName}`;
      
      const slNo = 101 + i; // Starting from 101 as requested in example 1RVU23BSC113
      const usn = `1RVU23${PROGRAM_CODE}${slNo}`;
      
      // Email format: name+lastname.bsc23@rvu.edu.in
      const emailLocal = `${firstName.toLowerCase()}${lastName.toLowerCase()}.bsc23`;
      const collegeEmail = `${emailLocal}@rvu.edu.in`;
      const personalEmail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@gmail.com`;
      
      const majorId = pick(MAJORS, i);
      const minorId = pick(MINORS, i);
      const specId = pick(SPECS, i);

      await client.query('BEGIN');
      try {
        // 1. Basic Details
        await client.query(
          `INSERT INTO student_basic_details (
            usn, full_name, college_email, personal_email,
            school_id, program_id, major_id, minor_id, specialization_id,
            year_of_joining, current_year, current_semester, section,
            gender, is_registered, phone_country_code, phone_number,
            opt_in, has_agreed_placement_policy, is_placement_eligible
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, '+91', $15, true, true, true)
          ON CONFLICT (usn) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            college_email = EXCLUDED.college_email,
            personal_email = EXCLUDED.personal_email,
            major_id = EXCLUDED.major_id,
            minor_id = EXCLUDED.minor_id,
            specialization_id = EXCLUDED.specialization_id,
            opt_in = true,
            has_agreed_placement_policy = true,
            is_placement_eligible = true`,
          [
            usn, fullName, collegeEmail, personalEmail,
            SCHOOL_ID, PROGRAM_ID, majorId, minorId, specId,
            BATCH, 3, 6, i < 30 ? 'A' : 'B',
            i % 5 === 0 ? 'Female' : 'Male',
            `9${String(100000000 + i * 123456).slice(-9)}`
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
          [usn, `Motivated student from ${fullName}'s batch specializing in ${specId}.`]
        );

        // 4. Add some education history so profiles look complete
        await client.query(`DELETE FROM student_education_history WHERE usn = $1`, [usn]);
        await client.query(
          `INSERT INTO student_education_history (usn, education_level, institute_name, city, board, start_year, end_year, result, result_type)
           VALUES 
           ($1, '10TH', 'State Public School', 'Bangalore', 'CBSE', 2018, 2019, '90', 'PERCENTAGE'),
           ($1, '12TH', 'State PU College', 'Bangalore', 'Karnataka State Board', 2019, 2021, '85', 'PERCENTAGE')`,
          [usn]
        );

        // 5. Add some semester records
        await client.query(`DELETE FROM student_semester_records WHERE usn = $1`, [usn]);
        await client.query(
          `INSERT INTO student_semester_records (usn, academic_year, semester, sgpa, cgpa, cleared_backlogs, active_backlogs, result_file)
           VALUES 
           ($1, 2023, 1, 8.5, 8.5, 0, 0, 'https://example.com/result.pdf'),
           ($1, 2023, 2, 8.7, 8.6, 0, 0, 'https://example.com/result.pdf'),
           ($1, 2024, 3, 8.2, 8.4, 0, 0, 'https://example.com/result.pdf'),
           ($1, 2024, 4, 8.4, 8.4, 0, 0, 'https://example.com/result.pdf'),
           ($1, 2025, 5, 8.6, 8.5, 0, 0, 'https://example.com/result.pdf')`,
          [usn]
        );

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      if ((i + 1) % 10 === 0) console.log(`Inserted ${i + 1} students...`);
    }
    console.log('\nSuccessfully seeded 60 students.');
  } catch (e) {
    console.error('Error seeding students:', e);
  } finally {
    client.release();
    process.exit(0);
  }
}

seed60();
