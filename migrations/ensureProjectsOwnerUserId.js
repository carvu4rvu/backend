/**
 * Migration: Add owner_user_id to projects and backfill from user_login.
 * Identity standard: ownership uses user_id (user_login.id), not USN.
 *
 * Run from project root: node backend/migrations/ensureProjectsOwnerUserId.js
 * Requires DATABASE_URL in backend/.env (or root .env).
 */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../config/db');

const SQL_PATH = path.join(__dirname, 'add_projects_owner_user_id.sql');

async function run() {
  let client;
  try {
    const sql = fs.readFileSync(SQL_PATH, 'utf8');
    client = await pool.connect();
    await client.query(sql);
    console.log('Migration completed: projects.owner_user_id added and backfilled.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

run();
