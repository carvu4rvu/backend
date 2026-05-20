/**
 * Batch-load project_asset_variants keyed by original_url for showcase/list APIs.
 */

const pool = require('../config/db');

/**
 * @param {import('pg').PoolClient} client
 * @param {number[]} projectIds
 * @returns {Promise<Record<number, Record<string, Record<string, { url: string, width: number }>>>>}
 */
async function loadSnapVariantsByProjectIds(client, projectIds) {
  if (!projectIds?.length) return {};

  const res = await client.query(
    `SELECT a.project_id, TRIM(a.original_url) AS original_url,
            v.variant_type, v.variant_url, v.width
     FROM project_assets a
     INNER JOIN project_asset_variants v ON v.asset_id = a.id
     WHERE a.project_id = ANY($1::bigint[])
       AND a.original_url IS NOT NULL
       AND TRIM(a.original_url) <> ''
     ORDER BY a.project_id, a.position, v.variant_type`,
    [projectIds]
  );

  const byProject = {};
  (res.rows || []).forEach((row) => {
    const pid = row.project_id;
    const url = row.original_url;
    if (!url || !row.variant_url) return;
    if (!byProject[pid]) byProject[pid] = {};
    if (!byProject[pid][url]) byProject[pid][url] = {};
    byProject[pid][url][row.variant_type] = {
      url: row.variant_url,
      width: row.width ?? null,
    };
  });
  return byProject;
}

/**
 * Attach snap_variants map to each project in a list response.
 * @param {import('pg').PoolClient} client
 * @param {Array<{ id: number }>} projects
 */
async function attachSnapVariantsToProjects(client, projects) {
  if (!projects?.length) return projects;
  const ids = projects.map((p) => p.id).filter(Boolean);
  const byProject = await loadSnapVariantsByProjectIds(client, ids);
  projects.forEach((p) => {
    p.snap_variants = byProject[p.id] || {};
  });
  return projects;
}

/** Pool convenience wrapper for controllers that do not hold a client. */
async function attachSnapVariantsToProjectsPool(projects) {
  if (!projects?.length) return projects;
  const client = await pool.connect();
  try {
    return attachSnapVariantsToProjects(client, projects);
  } finally {
    client.release();
  }
}

module.exports = {
  loadSnapVariantsByProjectIds,
  attachSnapVariantsToProjects,
  attachSnapVariantsToProjectsPool,
};
