/**
 * Migration: student_projects -> projects + project_* tables
 *
 * Prerequisites:
 * - New tables must exist: projects, project_assets, project_metrics
 *   (and any triggers/constraints from database.txt)
 *
 * Run from project root: node backend/migrations/migrateStudentProjectsToProjects.js
 * Requires backend/.env (or root .env) with DATABASE_URL set.
 */

const path = require('path');
const fs = require('fs');

// Load backend/.env so DATABASE_URL is set when run from project root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../config/db');

const SQL_PATH = path.join(__dirname, 'migrate_student_projects_to_projects.sql');

async function run() {
  let client;
  try {
    const sql = fs.readFileSync(SQL_PATH, 'utf8');
    client = await pool.connect();
    await client.query(sql);
    console.log('Migration completed: student_projects -> projects + project_metrics + project_assets');
  } catch (err) {
    console.error('Migration failed:', err.message);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

run();
