/**
 * Seed alumni login: alumni@gmail.com / 123123
 * Creates registration code, alumni profile, and user_login (idempotent).
 *
 * Run from backend: node scripts/seedAlumniGmailLogin.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const ALUMNI_EMAIL = 'alumni@gmail.com';
const ALUMNI_PASSWORD = '123123';
const REG_CODE = 'ALUM-2022-GMAIL';

const ALUMNI_PROFILE = {
  full_name: 'Alex Rivera',
  graduation_year: 2022,
  institution_name: 'RV University',
  current_company: 'TechVentures India',
  current_designation: 'Senior Software Engineer',
  current_work_location: 'Bengaluru',
  phone_number: '+91 9876543200',
  linkedin: 'https://www.linkedin.com/in/alex-rivera-dev',
  other_links: {
    portfolio: 'https://alexrivera.dev',
    github: 'https://github.com/alexrivera-demo',
  },
  alumni_remark: 'Seeded demo alumni — available for mentoring and HR referrals.',
  is_verified: true,
  profile_image: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400',
};

async function getRoleId(client, roleName) {
  let q = await client.query(`SELECT id FROM roles WHERE lower(name) = lower($1) LIMIT 1`, [roleName]);
  if (q.rows.length) return q.rows[0].id;
  await client.query(
    `INSERT INTO roles (name) VALUES (lower($1)) ON CONFLICT ((lower(name))) DO NOTHING`,
    [roleName]
  );
  q = await client.query(`SELECT id FROM roles WHERE lower(name) = lower($1) LIMIT 1`, [roleName]);
  if (!q.rows.length) throw new Error(`Role not found: ${roleName}`);
  return q.rows[0].id;
}

async function ensureRegistrationCode(client) {
  const existing = await client.query(
    `SELECT id FROM alumni_registration_codes WHERE code = $1 LIMIT 1`,
    [REG_CODE]
  );
  if (existing.rows.length) {
    await client.query(
      `UPDATE alumni_registration_codes
       SET is_active = true, batch_year = $2, institution_name = $3, remarks = $4, max_uses = 0, updated_at = NOW()
       WHERE id = $1`,
      [
        existing.rows[0].id,
        ALUMNI_PROFILE.graduation_year,
        ALUMNI_PROFILE.institution_name,
        'Dev seed — use at /alumni/register',
      ]
    );
    return existing.rows[0].id;
  }

  const ins = await client.query(
    `INSERT INTO alumni_registration_codes
       (code, batch_year, institution_name, remarks, max_uses, used_count, is_active)
     VALUES ($1, $2, $3, $4, 0, 0, true)
     RETURNING id`,
    [
      REG_CODE,
      ALUMNI_PROFILE.graduation_year,
      ALUMNI_PROFILE.institution_name,
      'Dev seed — use at /alumni/register',
    ]
  );
  return ins.rows[0].id;
}

async function upsertAlumni(client, codeId) {
  const emailNorm = ALUMNI_EMAIL.toLowerCase();
  const p = ALUMNI_PROFILE;

  const existing = await client.query(
    `SELECT id FROM alumni WHERE lower(personal_email) = lower($1) LIMIT 1`,
    [emailNorm]
  );

  if (existing.rows.length) {
    const alumniId = existing.rows[0].id;
    await client.query(
      `UPDATE alumni
       SET full_name = $1, graduation_year = $2, institution_name = $3,
           current_company = $4, current_designation = $5, current_work_location = $6,
           personal_email = $7, phone_number = $8, linkedin = $9, other_links = $10::jsonb,
           alumni_remark = $11, is_verified = $12, profile_image = $13,
           registration_code_id = $14, updated_at = NOW()
       WHERE id = $15`,
      [
        p.full_name,
        p.graduation_year,
        p.institution_name,
        p.current_company,
        p.current_designation,
        p.current_work_location,
        emailNorm,
        p.phone_number,
        p.linkedin,
        JSON.stringify(p.other_links || {}),
        p.alumni_remark,
        p.is_verified,
        p.profile_image,
        codeId,
        alumniId,
      ]
    );
    return { alumniId, mode: 'updated' };
  }

  const ins = await client.query(
    `INSERT INTO alumni
       (student_id, full_name, graduation_year, institution_name, current_company, current_designation,
        current_work_location, personal_email, phone_number, linkedin, other_links, alumni_remark,
        is_verified, profile_image, registration_code_id)
     VALUES
       (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
     RETURNING id`,
    [
      p.full_name,
      p.graduation_year,
      p.institution_name,
      p.current_company,
      p.current_designation,
      p.current_work_location,
      emailNorm,
      p.phone_number,
      p.linkedin,
      JSON.stringify(p.other_links || {}),
      p.alumni_remark,
      p.is_verified,
      p.profile_image,
      codeId,
    ]
  );
  return { alumniId: ins.rows[0].id, mode: 'inserted' };
}

async function upsertLogin(client, roleId) {
  const emailNorm = ALUMNI_EMAIL.toLowerCase();
  const passwordHash = await bcrypt.hash(ALUMNI_PASSWORD, 10);

  const existing = await client.query(`SELECT id, role_id FROM user_login WHERE lower(email_id) = lower($1) LIMIT 1`, [
    emailNorm,
  ]);

  if (existing.rows.length) {
    await client.query(
      `UPDATE user_login
       SET role_id = $1, password_hash = $2, usn = NULL, is_active = true, updated_at = NOW()
       WHERE id = $3`,
      [roleId, passwordHash, existing.rows[0].id]
    );
    return { loginId: existing.rows[0].id, mode: 'updated' };
  }

  try {
    const ins = await client.query(
      `INSERT INTO user_login (usn, role_id, password_hash, email_id, is_active)
       VALUES (NULL, $1, $2, $3, true)
       RETURNING id`,
      [roleId, passwordHash, emailNorm]
    );
    return { loginId: ins.rows[0].id, mode: 'inserted' };
  } catch (err) {
    if (err.constraint === 'user_login_email_id_check') {
      throw new Error(
        'Database only allows @rvu.edu.in on user_login. Run migration to allow alumni Gmail logins, or use alumni@gmail.com only on personal_email with an @rvu.edu.in login.'
      );
    }
    throw err;
  }
}

async function main() {
  console.log('Seeding alumni login (alumni@gmail.com)...\n');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roleId = await getRoleId(client, 'alumni');
    const codeId = await ensureRegistrationCode(client);
    const alumni = await upsertAlumni(client, codeId);
    const login = await upsertLogin(client, roleId);
    await client.query('COMMIT');

    console.log('Registration code:', REG_CODE, `(id ${codeId})`);
    console.log('Alumni profile:', alumni.mode, `(id ${alumni.alumniId})`);
    console.log('Login:', login.mode, `(id ${login.loginId})`);
    console.log('\n--- Alumni login credentials ---');
    console.log('Email:   ', ALUMNI_EMAIL);
    console.log('Password:', ALUMNI_PASSWORD);
    console.log('Login URL: http://localhost:5173/login');
    console.log('After login → /placement/alumni-dashboard');
    console.log('\nOptional self-register flow: http://localhost:5173/alumni/register');
    console.log('Use code:', REG_CODE);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
