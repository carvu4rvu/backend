const pool = require('../config/db');
const transporter = require('../config/smtp');
const bcrypt = require('bcryptjs');
const generateToken = require('../utils/jwtGenerator');
const { normalizePhoneForDb } = require('../utils/phoneNormalizer');
const { validatePhoneNumber, validateOccupation } = require('../utils/profileValidators');

// Helper to send email
const sendOTPEmail = async (email, otp, purpose) => {
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: email,
    subject: `Your OTP for ${purpose} - CarvingYou`,
    text: `Your OTP for ${purpose} is ${otp}. It expires in 5 minutes.`
  };
  await transporter.sendMail(mailOptions);
};

// Helper to mask email
const maskEmail = (email) => {
  const [name, domain] = email.split('@');
  const maskedName = name.slice(0, 2) + '*'.repeat(name.length - 2);
  return `${maskedName}@${domain}`;
};

// --- REGISTRATION FLOW ---

// 1. Verify USN (Get Details)
exports.verifyUSN = async (req, res) => {
  const { usn } = req.body;
  try {
    const query = `
      SELECT 
        s.usn, 
        s.full_name, 
        s.college_email, 
        s.phone_number, 
        s.year_of_joining,
        s.current_year,
        s.current_semester,
        s.is_registered, 
        s.is_active,
        sc.name as school_name, 
        p.name as program_name
      FROM student_basic_details s
      LEFT JOIN schools sc ON s.school_id = sc.id
      LEFT JOIN programs p ON s.program_id = p.id
      WHERE s.usn = $1
    `;
    const result = await pool.query(query, [usn]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Student not found." });
    }

    const student = result.rows[0];
    if (!student.is_active) {
      return res.status(403).json({ message: "Student account is inactive." });
    }

    res.json({
      isRegistered: student.is_registered,
      student: {
        ...student,
        name: student.full_name,
        school: student.school_name,
        program: student.program_name
      },
      email: student.college_email
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// 2. Send College OTP
exports.sendCollegeOTP = async (req, res) => {
  const { usn } = req.body;
  try {
    const check = await pool.query(`SELECT college_email FROM student_basic_details WHERE usn = $1`, [usn]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: "Student not found." });
    }
    
    const email = check.rows[0].college_email;
    if (!email) {
      return res.status(400).json({ message: "No email linked to this USN." });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);

    await pool.query(`
      INSERT INTO user_otp_verification (identifier, otp_hash, purpose, expires_at)
      VALUES ($1, $2, 'REGISTRATION', NOW() + INTERVAL '5 minutes')
    `, [email, otpHash]);

    await sendOTPEmail(email, otp, 'REGISTRATION');
    res.json({ message: "OTP sent successfully", email }); // Return email for frontend confirmation if needed
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// 3. Verify College OTP
exports.verifyCollegeOTP = async (req, res) => {
  const { usn, otp } = req.body;
  try {
    // Fetch email using USN first
    const studentCheck = await pool.query(`SELECT college_email FROM student_basic_details WHERE usn = $1`, [usn]);
    if (studentCheck.rows.length === 0) {
       return res.status(404).json({ message: "Student not found." });
    }
    const email = studentCheck.rows[0].college_email;

    const otpQuery = `
      SELECT id, otp_hash FROM user_otp_verification
      WHERE identifier = $1 AND purpose = 'REGISTRATION' AND expires_at > NOW() AND verified = false
      ORDER BY created_at DESC LIMIT 1
    `;
    const otpResult = await pool.query(otpQuery, [email]);

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ message: "Invalid or expired OTP." });
    }

    const validOtp = await bcrypt.compare(otp, otpResult.rows[0].otp_hash);
    if (!validOtp) {
      return res.status(400).json({ message: "Invalid OTP." });
    }

    await pool.query(`UPDATE user_otp_verification SET verified = true WHERE id = $1`, [otpResult.rows[0].id]);
    res.json({ message: "OTP Verified" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// 4. Send Personal OTP
exports.sendPersonalOTP = async (req, res) => {
  const { email } = req.body;
  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);

    // Use existing 'REGISTRATION' purpose to satisfy DB check constraint
    await pool.query(`
      INSERT INTO user_otp_verification (identifier, otp_hash, purpose, expires_at)
      VALUES ($1, $2, 'REGISTRATION', NOW() + INTERVAL '5 minutes')
    `, [email, otpHash]);

    await sendOTPEmail(email, otp, 'Personal Email Verification');
    res.json({ message: "OTP sent to personal email." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// 5. Verify Personal OTP
exports.verifyPersonalOTP = async (req, res) => {
  const { email, otp } = req.body;
  try {
    const otpQuery = `
      SELECT id, otp_hash FROM user_otp_verification
      WHERE identifier = $1 AND purpose = 'REGISTRATION' AND expires_at > NOW() AND verified = false
      ORDER BY created_at DESC LIMIT 1
    `;
    const otpResult = await pool.query(otpQuery, [email]);

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ message: "Invalid or expired OTP." });
    }

    const validOtp = await bcrypt.compare(otp, otpResult.rows[0].otp_hash);
    if (!validOtp) {
      return res.status(400).json({ message: "Invalid OTP." });
    }

    await pool.query(`UPDATE user_otp_verification SET verified = true WHERE id = $1`, [otpResult.rows[0].id]);
    res.json({ message: "Personal Email Verified" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// 6. Register Student (Final Submit)
exports.registerStudent = async (req, res) => {
  const { usn, personalEmail, phone, dob, gender, password, parents } = req.body;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash(password, 10);

    // Validate and normalize personal phone - must be numeric and exactly 10 digits when provided
    const normalizedPersonal = normalizePhoneForDb(null, phone || '');
    if (phone && !normalizedPersonal.phone_number) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Personal contact must be numeric and exactly 10 digits.' });
    }
    const personalPhoneNumber = normalizedPersonal.phone_number || null;

    // Update Basic Details (include normalized phone)
    await client.query(`
      UPDATE student_basic_details 
      SET personal_email = $1, phone_number = $2, is_registered = true, gender = $3, date_of_birth = $4
      WHERE usn = $5
    `, [personalEmail, personalPhoneNumber, gender, dob, usn]);

    // Create User Login
    let roleRes = await client.query(`SELECT id FROM roles WHERE name = 'student'`);
    let roleId = roleRes.rows[0]?.id;
    if (!roleId) {
        const newRole = await client.query(`INSERT INTO roles (name) VALUES ('student') RETURNING id`);
        roleId = newRole.rows[0].id;
    }

    const studentRes = await client.query(`SELECT college_email FROM student_basic_details WHERE usn = $1`, [usn]);
    const collegeEmailRaw = studentRes.rows[0]?.college_email || null;

    // Enforce RVU-domain email for login table, matching DB check constraint:
    // email_id ~* '...@rvu\.edu\.in'
    if (!collegeEmailRaw || !/@rvu\.edu\.in$/i.test(String(collegeEmailRaw).trim())) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: "College email in university records is not an RVU email. Please contact the administration to update it before registering."
      });
    }

    const collegeEmail = String(collegeEmailRaw).trim().toLowerCase();

    // Check if user already exists
    const userCheck = await client.query(`SELECT id FROM user_login WHERE usn = $1`, [usn]);
    if (userCheck.rows.length > 0) {
         await client.query(`UPDATE user_login SET password_hash = $1, email_id = $2 WHERE usn = $3`, [passwordHash, collegeEmail, usn]);
    } else {
        await client.query(`
          INSERT INTO user_login (usn, role_id, password_hash, email_id) 
          VALUES ($1, $2, $3, $4)
        `, [usn, roleId, passwordHash, collegeEmail]);
    }

    // Insert Parents if possible
    if (parents && parents.length > 0) {
      try {
        // Align with actual schema:
        // CREATE TABLE public.student_parent_details (
        //   id integer PRIMARY KEY,
        //   usn text NOT NULL,
        //   parent_type text NOT NULL,
        //   name text NOT NULL,
        //   ...
        // );

        // Remove any existing parent records for this student
        await client.query(`DELETE FROM student_parent_details WHERE usn = $1`, [usn]);

        for (const p of parents) {
          if (!p || !p.name || !p.type) continue;

          // Validate occupation (if present) and parent phone (if present)
          const occCheck = validateOccupation(p.occupation || '');
          if (!occCheck.valid) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Parent occupation invalid: ${occCheck.message}` });
          }

          const rawParentPhone = p.phone || p.phone_number || p.contact || '';
          const parsed = normalizePhoneForDb(p.phone_country_code || null, rawParentPhone);
          if (rawParentPhone && !parsed.phone_number) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Parent contact must be numeric and exactly 10 digits.' });
          }

          await client.query(`
            INSERT INTO student_parent_details (usn, parent_type, name, occupation, phone_number, phone_country_code)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [usn, p.type, p.name, p.occupation || null, parsed.phone_number || null, parsed.phone_country_code || null]);
        }
      } catch (pErr) {
        console.warn("Parent insertion failed:", pErr.message);
      }
    }

    await client.query('COMMIT');

    const userRes = await client.query(`SELECT id FROM user_login WHERE usn = $1`, [usn]);
    const userId = userRes.rows[0].id;
    const token = generateToken(userId, usn, 'student');

    res.json({ ok: true, access: token, user: { usn, role: 'student', email: collegeEmail } });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: "Registration failed", error: err.message });
  } finally {
    client.release();
  }
};

// --- LOGIN & OTHERS ---
exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const query = `
      SELECT ul.id, ul.usn, ul.email_id, ul.password_hash, ul.is_active, s.is_registered, r.name as role_name
      FROM user_login ul
      JOIN roles r ON r.id = ul.role_id
      LEFT JOIN student_basic_details s ON s.usn = ul.usn
      WHERE ul.email_id = $1
    `;
    const result = await pool.query(query, [email]);

    if (result.rows.length === 0) {
       // Only check registration for students (if not found in login table, check if student exists but not registered)
       // This part is a bit tricky if they aren't in user_login at all.
       // The original logic was checking student_basic_details if user_login failed.
       const checkStudent = await pool.query(`SELECT is_registered FROM student_basic_details WHERE college_email = $1`, [email]);
       if (checkStudent.rows.length > 0 && !checkStudent.rows[0].is_registered) {
         return res.status(401).json({ message: "Account not registered. Please register first." });
       }
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const user = result.rows[0];
    if (!user.is_active) return res.status(403).json({ message: "Account is inactive." });

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      if (user.usn) {
          await pool.query(`UPDATE user_login SET failed_login_attempts = failed_login_attempts + 1 WHERE usn = $1`, [user.usn]);
      }
      return res.status(401).json({ message: "Invalid credentials." });
    }

    if (user.usn) {
        await pool.query(`UPDATE user_login SET last_login_at = NOW(), failed_login_attempts = 0 WHERE usn = $1`, [user.usn]);
    } else {
         // Update by ID for non-student users (like Admin) who might have null USN
        await pool.query(`UPDATE user_login SET last_login_at = NOW(), failed_login_attempts = 0 WHERE id = $1`, [user.id]);
    }
    
    const token = generateToken(user.id, user.usn, user.role_name);
    res.json({
      token,
      user: {
        id: user.id,
        usn: user.usn,
        role: user.role_name,
        email: user.email_id || null
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.forgotPasswordInitiate = async (req, res) => {
  const { email } = req.body;
  try {
     const userResult = await pool.query('SELECT usn FROM user_login WHERE email_id = $1 AND is_active = true', [email]);
     if (userResult.rows.length === 0) return res.status(404).json({ message: "User not found." });

     const otp = Math.floor(100000 + Math.random() * 900000).toString();
     const otpHash = await bcrypt.hash(otp, 10);

     await pool.query(`INSERT INTO user_otp_verification (identifier, otp_hash, purpose, expires_at) VALUES ($1, $2, 'PASSWORD_RESET', NOW() + INTERVAL '5 minutes')`, [email, otpHash]);
     await sendOTPEmail(email, otp, 'PASSWORD RESET');
     res.json({ message: "OTP sent to your email." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.forgotPasswordVerify = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  try {
    const otpQuery = `SELECT id, otp_hash FROM user_otp_verification WHERE identifier = $1 AND purpose = 'PASSWORD_RESET' AND expires_at > NOW() AND verified = false ORDER BY created_at DESC LIMIT 1`;
    const otpResult = await pool.query(otpQuery, [email]);

    if (otpResult.rows.length === 0) return res.status(400).json({ message: "Invalid or expired OTP." });

    const validOtp = await bcrypt.compare(otp, otpResult.rows[0].otp_hash);
    if (!validOtp) return res.status(400).json({ message: "Invalid OTP." });

    await pool.query(`UPDATE user_otp_verification SET verified = true WHERE id = $1`, [otpResult.rows[0].id]);
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query(`UPDATE user_login SET password_hash = $1 WHERE email_id = $2`, [passwordHash, email]);
    res.json({ message: "Password reset successful. Please login." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.verifyToken = (req, res) => {
  res.json({ valid: true, user: req.user });
};

// --- ALUMNI REGISTRATION ---

/**
 * POST /auth/alumni/validate-code
 * Body: { code }
 * Returns: { valid: true, code_id, remarks, batch_year, institution_name } or error
 */
exports.validateAlumniCode = async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Registration code is required.' });
  }
  try {
    const result = await pool.query(
      `SELECT id, code, batch_year, institution_name, remarks, max_uses, used_count, is_active, expires_at
       FROM alumni_registration_codes
       WHERE code = $1`,
      [code.trim()]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid registration code.' });
    }
    const row = result.rows[0];
    if (!row.is_active) {
      return res.status(400).json({ error: 'This registration code is no longer active.' });
    }
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This registration code has expired.' });
    }
    if (row.max_uses > 0 && (row.used_count || 0) >= row.max_uses) {
      return res.status(400).json({ error: 'This registration code has reached its maximum uses.' });
    }
    res.json({
      valid: true,
      code_id: row.id,
      remarks: row.remarks,
      batch_year: row.batch_year,
      institution_name: row.institution_name,
    });
  } catch (err) {
    console.error('validateAlumniCode:', err);
    res.status(500).json({ error: 'Server error.' });
  }
};

/**
 * POST /auth/alumni/send-otp
 * Body: { email, code_id }
 */
exports.sendAlumniOtp = async (req, res) => {
  const { email, code_id } = req.body;
  if (!email || !code_id) {
    return res.status(400).json({ error: 'Email and code_id are required.' });
  }
  try {
    const codeCheck = await pool.query(
      'SELECT id FROM alumni_registration_codes WHERE id = $1 AND is_active = true',
      [code_id]
    );
    if (codeCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid registration code.' });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    await pool.query(
      `INSERT INTO alumni_registration_requests (registration_code_id, email, otp_hash, otp_expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')`,
      [code_id, email.trim().toLowerCase(), otpHash]
    );
    await sendOTPEmail(email, otp, 'ALUMNI REGISTRATION');
    res.json({ message: 'OTP sent to your email.' });
  } catch (err) {
    console.error('sendAlumniOtp:', err);
    res.status(500).json({ error: 'Failed to send OTP.' });
  }
};

/**
 * POST /auth/alumni/verify-otp
 * Body: { email, otp }
 */
exports.verifyAlumniOtp = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required.' });
  }
  try {
    const result = await pool.query(
      `SELECT id, otp_hash, registration_code_id FROM alumni_registration_requests
       WHERE email = $1 AND is_email_verified = false AND otp_expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email.trim().toLowerCase()]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired OTP.' });
    }
    const row = result.rows[0];
    const valid = await bcrypt.compare(otp, row.otp_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid OTP.' });
    }
    await pool.query(
      'UPDATE alumni_registration_requests SET is_email_verified = true, verified_at = NOW() WHERE id = $1',
      [row.id]
    );
    res.json({ message: 'Email verified.' });
  } catch (err) {
    console.error('verifyAlumniOtp:', err);
    res.status(500).json({ error: 'Invalid OTP.' });
  }
};

/**
 * POST /auth/alumni/register
 * Body: { code_id, email, full_name, phone_number, password }
 */
exports.registerAlumni = async (req, res) => {
  const { code_id, email, full_name, phone_number, password } = req.body;
  if (!code_id || !email || !full_name || !password) {
    return res.status(400).json({ error: 'code_id, email, full_name and password are required.' });
  }
  const client = await pool.connect();
  try {
    const verified = await client.query(
      `SELECT id, registration_code_id FROM alumni_registration_requests
       WHERE email = $1 AND is_email_verified = true AND is_completed = false
       ORDER BY created_at DESC LIMIT 1`,
      [email.trim().toLowerCase()]
    );
    if (verified.rows.length === 0) {
      return res.status(400).json({ error: 'Please verify your email with OTP first.' });
    }
    const codeRow = await client.query(
      'SELECT id, batch_year, institution_name, remarks, max_uses, used_count FROM alumni_registration_codes WHERE id = $1 AND is_active = true',
      [code_id]
    );
    if (codeRow.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid registration code.' });
    }
    const code = codeRow.rows[0];
    const roleRes = await client.query("SELECT id FROM roles WHERE name = 'alumni'");
    if (roleRes.rows.length === 0) {
      return res.status(500).json({ error: 'Alumni role is not configured. Contact admin.' });
    }
    const roleId = roleRes.rows[0].id;
    const passwordHash = await bcrypt.hash(password, 10);
    const emailNorm = email.trim().toLowerCase();
    const userIns = await client.query(
      `INSERT INTO user_login (usn, role_id, password_hash, email_id)
       VALUES (NULL, $1, $2, $3)
       RETURNING id`,
      [roleId, passwordHash, emailNorm]
    );
    const userId = userIns.rows[0].id;
    const alumniIns = await client.query(
      `INSERT INTO alumni (full_name, graduation_year, institution_name, personal_email, phone_number, registration_code_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [full_name.trim(), code.batch_year, code.institution_name || '', emailNorm, phone_number?.trim() || null, code_id]
    );
    const alumniId = alumniIns.rows[0].id;
    await client.query(
      'UPDATE alumni_registration_requests SET is_completed = true WHERE id = $1',
      [verified.rows[0].id]
    );
    await client.query(
      'UPDATE alumni_registration_codes SET used_count = COALESCE(used_count, 0) + 1 WHERE id = $1',
      [code_id]
    );
    res.status(201).json({ message: 'Registration successful. You can now login.', alumni_id: alumniId });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'This email is already registered.' });
    }
    if (err.constraint === 'user_login_email_id_check') {
      return res.status(400).json({ error: 'Only college email (@rvu.edu.in) is allowed for login. Please use your college email.' });
    }
    console.error('registerAlumni:', err);
    res.status(500).json({ error: 'Registration failed.' });
  } finally {
    client.release();
  }
};

// --- ADMIN: User Login Management ---

/**
 * GET /api/auth/admin/user-login
 * List user_login with filters: role_id, is_active, search (usn/email). Admin/superadmin only.
 */
exports.getAdminUserLoginList = async (req, res) => {
  try {
    const { role_id, is_active, search, page = 1, limit = 50 } = req.query;
    const offset = Math.max(0, (Number(page) || 1) - 1) * Math.min(100, Math.max(1, Number(limit) || 50));
    const limitVal = Math.min(100, Math.max(1, Number(limit) || 50));

    let where = [];
    let params = [];
    let idx = 1;

    if (role_id !== undefined && role_id !== '' && role_id !== 'all') {
      where.push(`ul.role_id = $${idx}`);
      params.push(role_id);
      idx++;
    }
    if (is_active !== undefined && is_active !== '' && is_active !== 'all') {
      const active = String(is_active).toLowerCase() === 'true';
      where.push(`ul.is_active = $${idx}`);
      params.push(active);
      idx++;
    }
    if (search && search.trim()) {
      where.push(`(ul.usn ILIKE $${idx} OR ul.email_id ILIKE $${idx})`);
      params.push(`%${search.trim()}%`);
      idx++;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM user_login ul
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const total = countResult.rows[0]?.total ?? 0;

    params.push(limitVal, offset);
    const listQuery = `
      SELECT ul.id, ul.usn, ul.email_id, ul.is_active, ul.last_login_at, ul.failed_login_attempts, ul.created_at,
             r.id AS role_id, r.name AS role_name
      FROM user_login ul
      JOIN roles r ON r.id = ul.role_id
      ${whereClause}
      ORDER BY ul.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    const listResult = await pool.query(listQuery, params);
    const rolesResult = await pool.query('SELECT id, name FROM roles ORDER BY name');
    res.json({
      users: listResult.rows,
      roles: rolesResult.rows,
      total,
      page: Number(page) || 1,
      limit: limitVal,
    });
  } catch (err) {
    console.error('getAdminUserLoginList:', err);
    res.status(500).json({ message: 'Failed to fetch user list' });
  }
};

/**
 * PATCH /api/auth/admin/user-login/:id
 * Update single user is_active. Admin/superadmin only.
 */
exports.patchUserLoginIsActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ message: 'is_active must be a boolean' });
    }
    const result = await pool.query(
      'UPDATE user_login SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, usn, email_id, is_active',
      [is_active, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('patchUserLoginIsActive:', err);
    res.status(500).json({ message: 'Failed to update user' });
  }
};

/**
 * PATCH /api/auth/admin/user-login/bulk
 * Bulk update is_active for given ids. Admin/superadmin only.
 */
exports.patchBulkUserLoginIsActive = async (req, res) => {
  try {
    const { ids, is_active } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids must be a non-empty array' });
    }
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ message: 'is_active must be a boolean' });
    }
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
    const result = await pool.query(
      `UPDATE user_login SET is_active = $1, updated_at = NOW() WHERE id IN (${placeholders}) RETURNING id, usn, email_id, is_active`,
      [is_active, ...ids]
    );
    res.json({ updated: result.rowCount, users: result.rows });
  } catch (err) {
    console.error('patchBulkUserLoginIsActive:', err);
    res.status(500).json({ message: 'Failed to bulk update' });
  }
};

/**
 * GET /api/auth/admin/students-without-login
 * List students in student_basic_details who have no user_login record.
 * Filters: school_id, program_id, year_of_joining, search (usn, full_name, college_email).
 */
exports.getStudentsWithoutLogin = async (req, res) => {
  try {
    const { school_id, program_id, year_of_joining, search, page = 1, limit = 50 } = req.query;
    const offset = Math.max(0, (Number(page) || 1) - 1) * Math.min(100, Math.max(1, Number(limit) || 50));
    const limitVal = Math.min(100, Math.max(1, Number(limit) || 50));

    const where = ['ul.id IS NULL'];
    const params = [];
    let idx = 1;

    if (school_id !== undefined && school_id !== '' && school_id !== 'all') {
      where.push(`s.school_id = $${idx}`);
      params.push(school_id);
      idx++;
    }
    if (program_id !== undefined && program_id !== '' && program_id !== 'all') {
      where.push(`s.program_id = $${idx}`);
      params.push(program_id);
      idx++;
    }
    if (year_of_joining !== undefined && year_of_joining !== '' && year_of_joining !== 'all') {
      where.push(`s.year_of_joining = $${idx}`);
      params.push(Number(year_of_joining));
      idx++;
    }
    if (search && search.trim()) {
      where.push(`(s.usn ILIKE $${idx} OR s.full_name ILIKE $${idx} OR s.college_email ILIKE $${idx})`);
      params.push(`%${search.trim()}%`);
      idx++;
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const baseFrom = `
      FROM student_basic_details s
      LEFT JOIN user_login ul ON ul.usn = s.usn
      LEFT JOIN schools sc ON sc.id = s.school_id
      LEFT JOIN programs p ON p.id = s.program_id
      ${whereClause}
    `;

    const countQuery = `SELECT COUNT(*)::int AS total ${baseFrom}`;
    const countResult = await pool.query(countQuery, params);
    const total = countResult.rows[0]?.total ?? 0;

    params.push(limitVal, offset);
    const listQuery = `
      SELECT s.usn, s.full_name, s.college_email, s.year_of_joining, s.current_year,
             s.school_id, s.program_id, sc.name AS school_name, p.name AS program_name
      ${baseFrom}
      ORDER BY s.year_of_joining DESC, s.usn
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    const listResult = await pool.query(listQuery, params);

    const schoolsResult = await pool.query('SELECT id, name FROM schools ORDER BY name');
    const programsResult = await pool.query('SELECT id, name, school_id FROM programs ORDER BY name');
    const yearsResult = await pool.query(`
      SELECT DISTINCT s.year_of_joining AS year
      FROM student_basic_details s
      LEFT JOIN user_login ul ON ul.usn = s.usn
      WHERE ul.id IS NULL AND s.year_of_joining IS NOT NULL
      ORDER BY s.year_of_joining DESC
    `);

    res.json({
      students: listResult.rows,
      schools: schoolsResult.rows,
      programs: programsResult.rows,
      years: (yearsResult.rows || []).map((r) => r.year),
      total,
      page: Number(page) || 1,
      limit: limitVal,
    });
  } catch (err) {
    console.error('getStudentsWithoutLogin:', err);
    res.status(500).json({ message: 'Failed to fetch students without login' });
  }
};

// --- ADMIN: Company Login Management ---

/**
 * GET /api/auth/admin/company-logins
 * List all company logins with company details
 */
exports.getCompanyLogins = async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const offset = Math.max(0, (Number(page) || 1) - 1) * Math.min(100, Math.max(1, Number(limit) || 50));
    const limitVal = Math.min(100, Math.max(1, Number(limit) || 50));

    // Get or create company role
    let roleRes = await pool.query("SELECT id FROM roles WHERE name = 'company'");
    if (roleRes.rows.length === 0) {
      // Company role doesn't exist yet, return empty
      const companiesResult = await pool.query('SELECT id, company_name FROM companies ORDER BY company_name');
      return res.json({
        logins: [],
        companies: companiesResult.rows,
        total: 0,
        page: 1,
        limit: limitVal,
      });
    }
    const companyRoleId = roleRes.rows[0].id;

    let where = [`ul.role_id = $1`];
    let params = [companyRoleId];
    let idx = 2;

    if (search && search.trim()) {
      where.push(`(ul.email_id ILIKE $${idx} OR c.company_name ILIKE $${idx})`);
      params.push(`%${search.trim()}%`);
      idx++;
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM user_login ul
      LEFT JOIN companies c ON c.id = ul.company_id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const total = countResult.rows[0]?.total ?? 0;

    params.push(limitVal, offset);
    const listQuery = `
      SELECT ul.id, ul.email_id, ul.is_active, ul.last_login_at, ul.created_at, ul.company_id,
             c.company_name, c.company_type, c.website
      FROM user_login ul
      LEFT JOIN companies c ON c.id = ul.company_id
      ${whereClause}
      ORDER BY ul.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    const listResult = await pool.query(listQuery, params);

    // Get all companies for the dropdown
    const companiesResult = await pool.query('SELECT id, company_name FROM companies ORDER BY company_name');

    // Get companies that already have logins
    const existingLoginsResult = await pool.query(
      `SELECT DISTINCT company_id FROM user_login WHERE company_id IS NOT NULL AND role_id = $1`,
      [companyRoleId]
    );
    const companiesWithLogins = existingLoginsResult.rows.map(r => r.company_id);

    res.json({
      logins: listResult.rows,
      companies: companiesResult.rows,
      companiesWithLogins,
      total,
      page: Number(page) || 1,
      limit: limitVal,
    });
  } catch (err) {
    console.error('getCompanyLogins:', err);
    res.status(500).json({ message: 'Failed to fetch company logins' });
  }
};

/**
 * POST /api/auth/admin/company-login
 * Create a new company login
 * Body: { company_id, email, password }
 */
exports.createCompanyLogin = async (req, res) => {
  const { company_id, email, password } = req.body;

  if (!company_id || !email || !password) {
    return res.status(400).json({ message: 'company_id, email and password are required' });
  }

  try {
    // Verify company exists
    const companyCheck = await pool.query('SELECT id, company_name FROM companies WHERE id = $1', [company_id]);
    if (companyCheck.rows.length === 0) {
      return res.status(400).json({ message: 'Company not found' });
    }

    // Get or create company role
    let roleRes = await pool.query("SELECT id FROM roles WHERE name = 'company'");
    let companyRoleId;
    if (roleRes.rows.length === 0) {
      const newRole = await pool.query("INSERT INTO roles (name) VALUES ('company') RETURNING id");
      companyRoleId = newRole.rows[0].id;
    } else {
      companyRoleId = roleRes.rows[0].id;
    }

    // Check if email already exists
    const emailCheck = await pool.query('SELECT id FROM user_login WHERE email_id = $1', [email.trim().toLowerCase()]);
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ message: 'A login with this email already exists' });
    }

    // Check if company already has a login
    const companyLoginCheck = await pool.query(
      'SELECT id FROM user_login WHERE company_id = $1 AND role_id = $2',
      [company_id, companyRoleId]
    );
    if (companyLoginCheck.rows.length > 0) {
      return res.status(400).json({ message: 'This company already has a login. Delete the existing one first.' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user login
    const insertResult = await pool.query(
      `INSERT INTO user_login (usn, role_id, password_hash, email_id, company_id, is_active)
       VALUES (NULL, $1, $2, $3, $4, true)
       RETURNING id, email_id, company_id, is_active, created_at`,
      [companyRoleId, passwordHash, email.trim().toLowerCase(), company_id]
    );

    const newLogin = insertResult.rows[0];
    newLogin.company_name = companyCheck.rows[0].company_name;

    res.status(201).json({
      message: 'Company login created successfully',
      login: newLogin,
    });
  } catch (err) {
    console.error('createCompanyLogin:', err);
    if (err.code === '23505') {
      return res.status(400).json({ message: 'This email is already registered' });
    }
    res.status(500).json({ message: 'Failed to create company login' });
  }
};

/**
 * DELETE /api/auth/admin/company-login/:id
 * Delete a company login
 */
exports.deleteCompanyLogin = async (req, res) => {
  const { id } = req.params;
  try {
    // Verify it's a company login
    const roleRes = await pool.query("SELECT id FROM roles WHERE name = 'company'");
    if (roleRes.rows.length === 0) {
      return res.status(404).json({ message: 'Login not found' });
    }
    const companyRoleId = roleRes.rows[0].id;

    const result = await pool.query(
      'DELETE FROM user_login WHERE id = $1 AND role_id = $2 RETURNING id',
      [id, companyRoleId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Company login not found' });
    }
    res.json({ message: 'Company login deleted successfully' });
  } catch (err) {
    console.error('deleteCompanyLogin:', err);
    res.status(500).json({ message: 'Failed to delete company login' });
  }
};

