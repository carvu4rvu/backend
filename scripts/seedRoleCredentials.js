/**
 * Seed one complete login-enabled record for each non-student/non-admin role:
 * - alumni
 * - company
 * - vc
 *
 * Password for all seeded logins: 123123
 *
 * Run from backend:
 *   node scripts/seedRoleCredentials.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const DEFAULT_PASSWORD = '123123';

const SEED = {
  alumni: {
    email: 'alumni.seed@rvu-demo.com',
    profile: {
      full_name: 'Daniel Foster',
      graduation_year: 2021,
      institution_name: 'RV University',
      current_company: 'Asterion Tech',
      current_designation: 'Senior Product Analyst',
      current_work_location: 'Bengaluru',
      personal_email: 'daniel.foster.personal@gmail.com',
      phone_number: '+91 9876501122',
      linkedin: 'https://www.linkedin.com/in/danielfoster-analytics',
      other_links: { portfolio: 'https://danielfoster.me', medium: 'https://medium.com/@danielfoster' },
      alumni_remark: 'Open to mentoring final-year students.',
      is_verified: true,
      profile_image: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400',
    },
  },
  company: {
    email: 'company.seed@rvu-demo.com',
    company: {
      company_name: 'Northbridge Analytics Labs',
      description: 'Data products and AI decision-support systems for enterprises.',
      company_type: 'Technology',
      address: '26, Residency Road, Bengaluru, Karnataka',
      website: 'https://northbridge-analytics.example.com',
      linkedin: 'https://www.linkedin.com/company/northbridge-analytics-labs',
      remarks: ['Seeded role account', 'Campus hiring enabled'],
      company_logo_link: 'https://logo.clearbit.com/ibm.com',
    },
    contact: {
      contact_name: 'Aisha Menon',
      email: 'aisha.menon@northbridge-analytics.example.com',
      phone_number: '+91 9988776655',
      role_title: 'Talent Acquisition Lead',
      remarks: 'Primary placement point of contact',
    },
  },
  vc: {
    email: 'vc.seed@rvu.edu.in',
  },
};

async function getRoleId(client, roleName) {
  let q = await client.query(`SELECT id FROM roles WHERE lower(name) = lower($1) LIMIT 1`, [roleName]);
  if (q.rows.length) return q.rows[0].id;

  await client.query(
    `INSERT INTO roles (name)
     VALUES (lower($1))
     ON CONFLICT ((lower(name))) DO NOTHING`,
    [roleName]
  );
  q = await client.query(`SELECT id FROM roles WHERE lower(name) = lower($1) LIMIT 1`, [roleName]);
  if (!q.rows.length) throw new Error(`Role not found/created: ${roleName}`);
  return q.rows[0].id;
}

async function upsertUserLogin(client, { email, roleId, companyId = null }) {
  const emailNorm = String(email).trim().toLowerCase();
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  const existing = await client.query(`SELECT id FROM user_login WHERE email_id = $1 LIMIT 1`, [emailNorm]);
  if (existing.rows.length) {
    const id = existing.rows[0].id;
    await client.query(
      `UPDATE user_login
       SET role_id = $1,
           password_hash = $2,
           company_id = $3,
           usn = NULL,
           is_active = true,
           updated_at = NOW()
       WHERE id = $4`,
      [roleId, passwordHash, companyId, id]
    );
    return { id, mode: 'updated' };
  }

  const inserted = await client.query(
    `INSERT INTO user_login (usn, role_id, password_hash, email_id, company_id, is_active)
     VALUES (NULL, $1, $2, $3, $4, true)
     RETURNING id`,
    [roleId, passwordHash, emailNorm, companyId]
  );
  return { id: inserted.rows[0].id, mode: 'inserted' };
}

async function seedAlumni(client) {
  const roleId = await getRoleId(client, 'alumni');
  const p = SEED.alumni.profile;

  const existing = await client.query(`SELECT id FROM alumni WHERE personal_email = $1 LIMIT 1`, [p.personal_email]);
  let alumniId;
  if (existing.rows.length) {
    alumniId = existing.rows[0].id;
    await client.query(
      `UPDATE alumni
       SET full_name = $1,
           graduation_year = $2,
           institution_name = $3,
           current_company = $4,
           current_designation = $5,
           current_work_location = $6,
           phone_number = $7,
           linkedin = $8,
           other_links = $9::jsonb,
           alumni_remark = $10,
           is_verified = $11,
           profile_image = $12,
           updated_at = NOW()
       WHERE id = $13`,
      [
        p.full_name,
        p.graduation_year,
        p.institution_name,
        p.current_company,
        p.current_designation,
        p.current_work_location,
        p.phone_number,
        p.linkedin,
        JSON.stringify(p.other_links || {}),
        p.alumni_remark,
        p.is_verified,
        p.profile_image,
        alumniId,
      ]
    );
  } else {
    const ins = await client.query(
      `INSERT INTO alumni
        (student_id, full_name, graduation_year, institution_name, current_company, current_designation,
         current_work_location, personal_email, phone_number, linkedin, other_links, alumni_remark, is_verified, profile_image)
       VALUES
        (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
       RETURNING id`,
      [
        p.full_name,
        p.graduation_year,
        p.institution_name,
        p.current_company,
        p.current_designation,
        p.current_work_location,
        p.personal_email,
        p.phone_number,
        p.linkedin,
        JSON.stringify(p.other_links || {}),
        p.alumni_remark,
        p.is_verified,
        p.profile_image,
      ]
    );
    alumniId = ins.rows[0].id;
  }

  const login = await upsertUserLogin(client, {
    email: SEED.alumni.email,
    roleId,
    companyId: null,
  });

  return { role: 'alumni', loginEmail: SEED.alumni.email, alumniId, login };
}

async function seedCompany(client) {
  const roleId = await getRoleId(client, 'company');
  const c = SEED.company.company;
  const contact = SEED.company.contact;

  const existingCompany = await client.query(`SELECT id FROM companies WHERE company_name = $1 LIMIT 1`, [c.company_name]);
  let companyId;
  if (existingCompany.rows.length) {
    companyId = existingCompany.rows[0].id;
    await client.query(
      `UPDATE companies
       SET description = $1,
           company_type = $2,
           address = $3,
           website = $4,
           linkedin = $5,
           remarks = $6,
           company_logo_link = $7,
           updated_at = NOW()
       WHERE id = $8`,
      [c.description, c.company_type, c.address, c.website, c.linkedin, c.remarks, c.company_logo_link, companyId]
    );
  } else {
    const ins = await client.query(
      `INSERT INTO companies
        (company_name, description, company_type, address, website, linkedin, remarks, company_logo_link)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [c.company_name, c.description, c.company_type, c.address, c.website, c.linkedin, c.remarks, c.company_logo_link]
    );
    companyId = ins.rows[0].id;
  }

  const existingContact = await client.query(
    `SELECT id FROM contacts WHERE company_id = $1 AND lower(email) = lower($2) LIMIT 1`,
    [companyId, contact.email]
  );
  if (existingContact.rows.length) {
    await client.query(
      `UPDATE contacts
       SET contact_name = $1,
           phone_number = $2,
           role_title = $3,
           remarks = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [contact.contact_name, contact.phone_number, contact.role_title, contact.remarks, existingContact.rows[0].id]
    );
  } else {
    await client.query(
      `INSERT INTO contacts
        (company_id, contact_name, email, phone_number, role_title, remarks)
       VALUES
        ($1, $2, $3, $4, $5, $6)`,
      [companyId, contact.contact_name, contact.email, contact.phone_number, contact.role_title, contact.remarks]
    );
  }

  const login = await upsertUserLogin(client, {
    email: SEED.company.email,
    roleId,
    companyId,
  });

  return { role: 'company', loginEmail: SEED.company.email, companyId, login };
}

async function seedVc(client) {
  const roleId = await getRoleId(client, 'vc');
  const login = await upsertUserLogin(client, {
    email: SEED.vc.email,
    roleId,
    companyId: null,
  });
  return { role: 'vc', loginEmail: SEED.vc.email, login };
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const alumni = await seedAlumni(client);
    const company = await seedCompany(client);
    const vc = await seedVc(client);
    await client.query('COMMIT');

    console.log('Seeded non-student role credentials successfully.\n');
    console.log(`alumni -> ${alumni.loginEmail} (login ${alumni.login.mode})`);
    console.log(`company -> ${company.loginEmail} (login ${company.login.mode})`);
    console.log(`vc -> ${vc.loginEmail} (login ${vc.login.mode})`);
    console.log(`Password for all: ${DEFAULT_PASSWORD}`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Seed failed:', err.message || err);
  process.exit(1);
});
