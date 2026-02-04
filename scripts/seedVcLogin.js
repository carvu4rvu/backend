/**
 * Seed script: creates the "vc" role and a login for vc@rvu.edu.in.
 * Run from backend: node scripts/seedVcLogin.js
 * Requires .env with DATABASE_URL. Uses PostgreSQL (same DB as auth).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

const VC_EMAIL = 'vc@rvu.edu.in';
const VC_PASSWORD = '123123';
const ROLE_NAME = 'vc';

async function seed() {
  console.log('Seeding VC role and login...\n');

  try {
    // 1. Ensure "vc" role exists
    let roleRes = await pool.query("SELECT id FROM roles WHERE name = $1", [ROLE_NAME]);
    let vcRoleId;
    if (roleRes.rows.length === 0) {
      const insertRole = await pool.query(
        "INSERT INTO roles (name) VALUES ($1) RETURNING id",
        [ROLE_NAME]
      );
      vcRoleId = insertRole.rows[0].id;
      console.log('Inserted role:', ROLE_NAME);
    } else {
      vcRoleId = roleRes.rows[0].id;
      console.log('Role "vc" already exists.');
    }

    // 2. Check if login already exists
    const existing = await pool.query(
      'SELECT id FROM user_login WHERE email_id = $1',
      [VC_EMAIL.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      console.log('Login for', VC_EMAIL, 'already exists. Skipping insert.');
      process.exit(0);
      return;
    }

    // 3. Insert VC login
    const passwordHash = await bcrypt.hash(VC_PASSWORD, 10);
    await pool.query(
      `INSERT INTO user_login (usn, role_id, password_hash, email_id, is_active)
       VALUES (NULL, $1, $2, $3, true)`,
      [vcRoleId, passwordHash, VC_EMAIL.toLowerCase()]
    );
    console.log('Created login for', VC_EMAIL, 'with role "vc".');
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
