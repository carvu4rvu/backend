const pool = require('../config/db');
const transporter = require('../config/smtp');
const bcrypt = require('bcryptjs'); // Assuming bcryptjs is installed or I will use bcrypt
const generateToken = require('../utils/jwtGenerator');
const crypto = require('crypto');

// Helper to send email
const sendOTPEmail = async (email, otp, purpose) => {
  const mailOptions = {
    from: process.env.gmail,
    to: email,
    subject: `Your OTP for ${purpose} - CarvingYou`,
    text: `Your OTP for ${purpose} is ${otp}. It expires in 5 minutes.`
  };
  await transporter.sendMail(mailOptions);
};

// 1. REGISTRATION FLOW

// Step 1: Initiate Registration (Check email/USN, send OTP)
exports.registerInitiate = async (req, res) => {
  const { email } = req.body; // User enters college email

  try {
    // Check if student exists
    const studentQuery = `SELECT usn, is_registered, is_active FROM student_basic_details WHERE college_email = $1`;
    const studentResult = await pool.query(studentQuery, [email]);

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ message: "Student record not found." });
    }

    const student = studentResult.rows[0];

    if (!student.is_active) {
      return res.status(403).json({ message: "Student account is not active." });
    }

    if (student.is_registered) {
      return res.status(409).json({ message: "Student is already registered. Please login." });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);

    // Store OTP
    const otpInsertQuery = `
      INSERT INTO user_otp_verification (identifier, otp_hash, purpose, expires_at)
      VALUES ($1, $2, 'REGISTRATION', NOW() + INTERVAL '5 minutes')
      RETURNING id;
    `;
    await pool.query(otpInsertQuery, [email, otpHash]);

    // Send Email
    await sendOTPEmail(email, otp, 'REGISTRATION');

    res.json({ message: "OTP sent to your college email.", usn: student.usn });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Step 2: Verify OTP and Create User
exports.registerVerify = async (req, res) => {
  const { email, otp, password } = req.body;

  try {
    // Verify OTP
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

    // Mark OTP as verified
    await pool.query(`UPDATE user_otp_verification SET verified = true WHERE id = $1`, [otpResult.rows[0].id]);

    // Get USN from email
    const studentQuery = `SELECT usn FROM student_basic_details WHERE college_email = $1`;
    const studentResult = await pool.query(studentQuery, [email]);
    const usn = studentResult.rows[0].usn;

    // Hash Password
    const passwordHash = await bcrypt.hash(password, 10);

    // Transaction: Create Login + Update Student Status
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get Student Role ID (assuming role 'student' exists in roles table, or hardcode/lookup)
      // For safety, let's lookup 'student' role or insert if not exists? 
      // Assuming 'student' role exists. Let's try to find it first.
      let roleResult = await client.query(`SELECT id FROM roles WHERE name = 'student'`);
      let roleId;
      if (roleResult.rows.length > 0) {
        roleId = roleResult.rows[0].id;
      } else {
          // Fallback or error? Let's assume ID 1 or create it. 
          // For now, let's assume 'student' is role_id 1 if not found, or insert.
          const newRole = await client.query(`INSERT INTO roles (name) VALUES ('student') RETURNING id`);
          roleId = newRole.rows[0].id;
      }

      await client.query(
        `INSERT INTO user_login (usn, role_id, password_hash) VALUES ($1, $2, $3)`,
        [usn, roleId, passwordHash]
      );

      await client.query(
        `UPDATE student_basic_details SET is_registered = true WHERE usn = $1`,
        [usn]
      );

      await client.query('COMMIT');
      res.json({ message: "Registration successful. Please login." });

    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// 2. LOGIN FLOW

exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Fetch Login Row
    const query = `
      SELECT ul.id, ul.usn, ul.password_hash, ul.is_active, s.is_registered, r.name as role_name
      FROM user_login ul
      JOIN student_basic_details s ON s.usn = ul.usn
      JOIN roles r ON r.id = ul.role_id
      WHERE s.college_email = $1
    `;
    const result = await pool.query(query, [email]);

    if (result.rows.length === 0) {
      // Check if student exists but not registered
      const checkStudent = await pool.query(`SELECT is_registered FROM student_basic_details WHERE college_email = $1`, [email]);
      if (checkStudent.rows.length > 0 && !checkStudent.rows[0].is_registered) {
        return res.status(401).json({ message: "Account not registered. Please register first." });
      }
      return res.status(401).json({ message: "Invalid credentials." });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ message: "Account is inactive." });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      // Increment failed attempts (optional implementation)
      await pool.query(`UPDATE user_login SET failed_login_attempts = failed_login_attempts + 1 WHERE usn = $1`, [user.usn]);
      return res.status(401).json({ message: "Invalid credentials." });
    }

    // Self-Heal: If user_login exists but is_registered is false
    if (!user.is_registered) {
      await pool.query(`UPDATE student_basic_details SET is_registered = true WHERE usn = $1`, [user.usn]);
    }

    // Update last_login_at and reset failed_login_attempts
    await pool.query(
      `UPDATE user_login SET last_login_at = NOW(), failed_login_attempts = 0 WHERE usn = $1`,
      [user.usn]
    );

    // Issue JWT
    const token = generateToken(user.id, user.usn, user.role_name);

    res.json({
      token,
      user: {
        usn: user.usn,
        role: user.role_name,
        email: email
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// 3. FORGOT PASSWORD FLOW

exports.forgotPasswordInitiate = async (req, res) => {
  const { email } = req.body;

  try {
    // Check if user exists
    const query = `
      SELECT s.usn, s.is_registered 
      FROM student_basic_details s
      JOIN user_login ul ON s.usn = ul.usn
      WHERE s.college_email = $1
    `;
    const result = await pool.query(query, [email]);

    if (result.rows.length === 0) {
      // Security: Don't reveal if user exists or not, but for now we can say "If account exists..."
      // Or return generic success to prevent enumeration. 
      // But prompt implies specific flow.
      return res.status(404).json({ message: "User not found." });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);

    await pool.query(`
      INSERT INTO user_otp_verification (identifier, otp_hash, purpose, expires_at)
      VALUES ($1, $2, 'PASSWORD_RESET', NOW() + INTERVAL '5 minutes')
    `, [email, otpHash]);

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
    // Verify OTP
    const otpQuery = `
      SELECT id, otp_hash FROM user_otp_verification
      WHERE identifier = $1 AND purpose = 'PASSWORD_RESET' AND expires_at > NOW() AND verified = false
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

    // Mark OTP verified
    await pool.query(`UPDATE user_otp_verification SET verified = true WHERE id = $1`, [otpResult.rows[0].id]);

    // Update Password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    
    // Get USN
    const studentQuery = `SELECT usn FROM student_basic_details WHERE college_email = $1`;
    const studentResult = await pool.query(studentQuery, [email]);
    const usn = studentResult.rows[0].usn;

    await pool.query(`UPDATE user_login SET password_hash = $1 WHERE usn = $2`, [passwordHash, usn]);

    res.json({ message: "Password reset successful. Please login." });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Verify token endpoint
exports.verifyToken = async (req, res) => {
  try {
    // This endpoint requires authentication middleware
    // If we reach here, token is valid
    const query = `
      SELECT ul.usn, r.name as role_name, s.college_email
      FROM user_login ul
      JOIN roles r ON r.id = ul.role_id
      JOIN student_basic_details s ON s.usn = ul.usn
      WHERE ul.id = $1
    `;
    const result = await pool.query(query, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = result.rows[0];
    res.json({
      valid: true,
      user: {
        usn: user.usn,
        role: user.role_name,
        email: user.college_email
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
