/**
 * Backfill: ensure every project has exactly one permanent share link (no expiry).
 * Run: node backend/scripts/ensureProjectShareLinks.js
 * Or from backend: node scripts/ensureProjectShareLinks.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');
const { ensureShareLink } = require('../controllers/projectController');

async function main() {
  const client = await pool.connect();
  try {
    const noLinkRes = await client.query(`
      SELECT p.id
      FROM projects p
      LEFT JOIN project_share_links psl ON psl.project_id = p.id AND psl.is_active = true AND (psl.expires_at IS NULL OR psl.expires_at > NOW())
      WHERE psl.id IS NULL
      ORDER BY p.id
    `);
    const projectIds = (noLinkRes.rows || []).map((r) => r.id);
    if (projectIds.length === 0) {
      console.log('All projects already have an active share link. Nothing to do.');
      return;
    }
    console.log(`Found ${projectIds.length} project(s) without an active share link. Creating...`);
    let created = 0;
    for (const projectId of projectIds) {
      await ensureShareLink(client, projectId);
      created++;
      console.log(`  Created share link for project id ${projectId}`);
    }
    console.log(`Done. Created ${created} share link(s).`);
  } finally {
    client.release();
    pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
