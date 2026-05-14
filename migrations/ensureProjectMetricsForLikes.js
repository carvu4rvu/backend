/**
 * Ensure every project has a project_metrics row and likes count is correct.
 * Run: node backend/migrations/ensureProjectMetricsForLikes.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

async function run() {
  const client = await pool.connect();
  try {
    // Create project_metrics for projects that don't have one, with correct likes from project_likes
    const r = await client.query(`
      INSERT INTO project_metrics (project_id, views, likes, favorites, comments, last_updated)
      SELECT p.id, 0,
        (SELECT COUNT(*)::int FROM project_likes pl WHERE pl.project_id = p.id),
        0, 0, NOW()
      FROM projects p
      WHERE NOT EXISTS (SELECT 1 FROM project_metrics m WHERE m.project_id = p.id)
      ON CONFLICT (project_id) DO NOTHING
    `);
    console.log(`[ensureProjectMetrics] Created ${r.rowCount} project_metrics rows for projects that were missing them`);

    // Sync likes count from project_likes for any project_metrics that might be out of sync
    const r2 = await client.query(`
      UPDATE project_metrics m
      SET likes = (SELECT COUNT(*)::int FROM project_likes pl WHERE pl.project_id = m.project_id),
          last_updated = NOW()
      WHERE m.likes != (SELECT COUNT(*)::int FROM project_likes pl WHERE pl.project_id = m.project_id)
    `);
    console.log(`[ensureProjectMetrics] Synced likes count for ${r2.rowCount} projects`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
