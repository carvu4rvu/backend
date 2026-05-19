/**
 * Create/update login credentials for every company.
 *
 * Email format: <companyname>@gmail.com
 * Password: 123123
 *
 * Run from backend:
 *   node scripts/seedCompanyLogins.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const DEFAULT_PASSWORD = '123123';

function toCompanyEmail(companyName) {
  const localPart = String(companyName || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');

  if (!localPart) {
    throw new Error(`Cannot build email for company name: ${companyName}`);
  }

  return `${localPart}@gmail.com`;
}

async function getCompanyRoleId(client) {
  const { rows } = await client.query(
    "SELECT id FROM roles WHERE lower(name) = 'company' LIMIT 1"
  );
  if (!rows.length) throw new Error('Role not found: company');
  return rows[0].id;
}

async function main() {
  const client = await pool.connect();
  try {
    const companyRoleId = await getCompanyRoleId(client);
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const { rows: companies } = await client.query(
      'SELECT id, company_name FROM companies ORDER BY id'
    );

    if (!companies.length) {
      console.log('No companies found.');
      return;
    }

    const generatedEmails = new Map();
    for (const company of companies) {
      const email = toCompanyEmail(company.company_name);
      if (generatedEmails.has(email)) {
        throw new Error(
          `Duplicate generated email ${email} for companies ${generatedEmails.get(email)} and ${company.id}`
        );
      }
      generatedEmails.set(email, company.id);
    }

    await client.query('BEGIN');

    const results = [];
    for (const company of companies) {
      const email = toCompanyEmail(company.company_name);

      const existingForCompany = await client.query(
        'SELECT id, email_id FROM user_login WHERE role_id = $1 AND company_id = $2 LIMIT 1',
        [companyRoleId, company.id]
      );

      if (existingForCompany.rows.length) {
        const login = existingForCompany.rows[0];
        await client.query(
          `UPDATE user_login
           SET email_id = $1,
               password_hash = $2,
               usn = NULL,
               is_active = true,
               updated_at = NOW()
           WHERE id = $3`,
          [email, passwordHash, login.id]
        );
        results.push({ mode: 'updated', company, email });
        continue;
      }

      const existingForEmail = await client.query(
        'SELECT id, company_id FROM user_login WHERE lower(email_id) = lower($1) LIMIT 1',
        [email]
      );

      if (existingForEmail.rows.length) {
        const login = existingForEmail.rows[0];
        await client.query(
          `UPDATE user_login
           SET role_id = $1,
               password_hash = $2,
               company_id = $3,
               usn = NULL,
               is_active = true,
               updated_at = NOW()
           WHERE id = $4`,
          [companyRoleId, passwordHash, company.id, login.id]
        );
        results.push({ mode: 'relinked', company, email });
        continue;
      }

      await client.query(
        `INSERT INTO user_login (usn, role_id, password_hash, email_id, company_id, is_active)
         VALUES (NULL, $1, $2, $3, $4, true)`,
        [companyRoleId, passwordHash, email, company.id]
      );
      results.push({ mode: 'inserted', company, email });
    }

    await client.query('COMMIT');

    const counts = results.reduce((acc, r) => {
      acc[r.mode] = (acc[r.mode] || 0) + 1;
      return acc;
    }, {});

    console.log(`Company logins processed: ${results.length}`);
    console.log(`Inserted: ${counts.inserted || 0}`);
    console.log(`Updated: ${counts.updated || 0}`);
    console.log(`Relinked: ${counts.relinked || 0}`);
    console.log(`Password for all company logins: ${DEFAULT_PASSWORD}`);
    console.log('');
    results.forEach((r) => {
      console.log(`${r.company.id}\t${r.company.company_name}\t${r.email}\t${r.mode}`);
    });
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
