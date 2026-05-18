const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

/**
 * Applies placement performance indexes (idempotent).
 */
async function ensurePlacementPerformanceIndexes() {
  const sqlPath = path.join(__dirname, 'ensurePlacementPerformanceIndexes.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

module.exports = ensurePlacementPerformanceIndexes;
