/**
 * Project Controller - Student projects API
 * Handles CRUD, feed, assets, share links, reviews, likes, favorites.
 * Tables: projects, project_assets, project_asset_variants, project_metrics,
 * project_likes, project_favorites, project_reviews,
 * project_share_links, project_views.
 */

const pool = require('../config/db');
const {
  sendError,
  sendNotFound,
  sendValidationError,
  sendAccessDenied,
  sendCaughtError,
} = require('../utils/apiErrorResponse');
const crypto = require('crypto');
const { enqueueVariantJob } = require('../services/variantJobProcessor');

const VALID_VISIBILITY = ['PRIVATE', 'PUBLIC'];
const VALID_ASSET_TYPES = ['IMAGE', 'VIDEO'];
const VALID_ASSET_ROLES = ['LOGO', 'COVER', 'GALLERY', 'VIDEO'];
const VALID_PROJECT_STATUS = ['not_approved', 'approved', 'rejected', 'archived'];

/**
 * Ensure project has exactly one permanent share link (no expiry). Creates one if missing.
 * @param {object} client - pg client
 * @param {number} projectId - projects.id
 * @returns {Promise<{ share_token: string }>}
 */
async function ensureShareLink(client, projectId) {
  const existing = await client.query(
    `SELECT share_token FROM project_share_links WHERE project_id = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY expires_at NULLS FIRST LIMIT 1`,
    [projectId]
  );
  if (existing.rows.length > 0) {
    return { share_token: existing.rows[0].share_token };
  }
  const shareToken = crypto.randomBytes(24).toString('hex');
  await client.query(
    `INSERT INTO project_share_links (project_id, share_token, expires_at, is_active) VALUES ($1, $2, NULL, true)`,
    [projectId, shareToken]
  );
  return { share_token: shareToken };
}

/** Ensure user owns project (by owner_usn or owner_user_id) */
async function assertOwnership(client, projectId, userId, usn) {
  const r = await client.query(
    'SELECT owner_usn, owner_user_id FROM projects WHERE id = $1',
    [projectId]
  );
  if (!r.rows.length) return { ok: false, error: 'not_found' };
  const p = r.rows[0];
  const matchUser = userId && p.owner_user_id && p.owner_user_id === userId;
  const matchUsn = usn && p.owner_usn && p.owner_usn.toUpperCase() === usn.toUpperCase();
  if (matchUser || matchUsn) return { ok: true };
  return { ok: false, error: 'access_denied' };
}

/** Load project with assets, metrics, and optionally ownership flags */
async function loadProject(client, projectId, options = {}) {
  const { forUserId, includeRank } = options;
  const projRes = await client.query(
    `SELECT p.id, p.owner_usn, p.owner_user_id, p.title, p.short_description, p.description,
      p.category, p.tags, p.visibility, p.hosted_url, p.github_url, p.mentor_name,
      p.tech_stack, p.published_at, p.created_at, p.updated_at, p.priority, p.project_status
     FROM projects p WHERE p.id = $1`,
    [projectId]
  );
  if (!projRes.rows.length) return null;
  const p = projRes.rows[0];

  const [assetsRes, metricsRes] = await Promise.all([
    client.query(
      'SELECT id, asset_type, asset_role, original_url, position FROM project_assets WHERE project_id = $1 ORDER BY position',
      [projectId]
    ),
    client.query(
      'SELECT views, likes, favorites, comments FROM project_metrics WHERE project_id = $1',
      [projectId]
    ),
  ]);

  const assets = assetsRes.rows || [];
  const metrics = metricsRes.rows[0] || { views: 0, likes: 0, favorites: 0, comments: 0 };

  let isLiked = false;
  let isFavorited = false;
  if (forUserId) {
    const [likeRes, favRes] = await Promise.all([
      client.query('SELECT 1 FROM project_likes WHERE project_id = $1 AND user_id = $2', [projectId, forUserId]),
      client.query('SELECT 1 FROM project_favorites WHERE project_id = $1 AND user_id = $2', [projectId, forUserId]),
    ]);
    isLiked = !!likeRes.rows.length;
    isFavorited = !!favRes.rows.length;
  }

  const project = {
    id: p.id,
    owner_usn: p.owner_usn,
    owner_user_id: p.owner_user_id,
    title: p.title,
    short_description: p.short_description,
    description: p.description,
    category: p.category,
    tags: Array.isArray(p.tags) ? p.tags : [],
    visibility: p.visibility || 'PRIVATE',
    hosted_url: p.hosted_url,
    github_url: p.github_url,
    mentor_name: p.mentor_name,
    tech_stack: Array.isArray(p.tech_stack) ? p.tech_stack : [],
    published_at: p.published_at,
    created_at: p.created_at,
    updated_at: p.updated_at,
    priority: p.priority,
    project_status: p.project_status,
    assets: assets.map((a) => ({
      id: a.id,
      asset_type: a.asset_type,
      asset_role: a.asset_role,
      original_url: a.original_url,
      position: a.position,
    })),
    views: metrics.views ?? 0,
    likes: metrics.likes ?? 0,
    favorites: metrics.favorites ?? 0,
    comments: metrics.comments ?? 0,
  };
  if (forUserId) {
    project.is_liked = isLiked;
    project.is_favorited = isFavorited;
  }
  return project;
}

/**
 * List projects
 * GET /api/projects?usn=...&profile=1
 * - No params: list projects for current user (student)
 * - usn + profile=1: list for profile view (any non-private, ordered by priority)
 */
exports.list = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?.user_id;
    const usn = req.user?.usn;
    const queryUsn = (req.query.usn || '').trim().toUpperCase();
    const isProfile = req.query.profile === '1' || req.query.profile === 'true';

    const client = await pool.connect();
    try {
      let targetUsn = queryUsn || usn;
      if (!targetUsn && !userId) {
        return sendError(res, 401, 'Authentication required');
      }
      if (!targetUsn && userId) {
        const uRes = await client.query('SELECT usn FROM user_login WHERE id = $1', [userId]);
        targetUsn = uRes.rows[0]?.usn ? uRes.rows[0].usn.toUpperCase() : null;
      }
      if (!targetUsn) {
        return res.json([]);
      }

      let sql = `SELECT p.id, p.owner_usn, p.owner_user_id, p.title, p.short_description, p.description,
        p.category, p.visibility, p.hosted_url, p.github_url, p.mentor_name, p.tech_stack,
        p.published_at, p.created_at, p.updated_at, p.priority, p.project_status
        FROM projects p WHERE p.owner_usn = $1`;
      const params = [targetUsn];

      if (isProfile) {
        sql += ` AND p.visibility != 'PRIVATE' ORDER BY p.priority ASC NULLS LAST, p.published_at DESC NULLS LAST, p.created_at DESC`;
      } else {
        sql += ` ORDER BY p.priority ASC NULLS LAST, p.created_at DESC`;
      }

      const projRes = await client.query(sql, params);
      const rows = projRes.rows || [];
      const projectIds = rows.map((r) => r.id);
      let assets = [];
      let metricsByProj = {};
      if (projectIds.length > 0) {
        const [assetRes, metricRes] = await Promise.all([
          client.query(
            'SELECT project_id, original_url, position FROM project_assets WHERE project_id = ANY($1::bigint[]) ORDER BY project_id, position',
            [projectIds]
          ),
          client.query(
            'SELECT project_id, views, likes, favorites FROM project_metrics WHERE project_id = ANY($1::bigint[])',
            [projectIds]
          ),
        ]);
        assets = assetRes.rows || [];
        (metricRes.rows || []).forEach((m) => {
          metricsByProj[m.project_id] = m;
        });
      }

      const byProject = {};
      assets.forEach((a) => {
        if (!byProject[a.project_id]) byProject[a.project_id] = [];
        byProject[a.project_id].push(a.original_url);
      });

      const list = rows.map((p) => {
        const m = metricsByProj[p.id] || {};
        return {
          id: p.id,
          owner_usn: p.owner_usn,
          owner_user_id: p.owner_user_id,
          title: p.title,
          short_description: p.short_description,
          description: p.description,
          category: p.category,
          visibility: p.visibility || 'PRIVATE',
          hosted_url: p.hosted_url,
          github_url: p.github_url,
          mentor_name: p.mentor_name,
          tech_stack: Array.isArray(p.tech_stack) ? p.tech_stack : [],
          published_at: p.published_at,
          created_at: p.created_at,
          updated_at: p.updated_at,
          priority: p.priority,
          project_status: p.project_status,
          project_snaps: byProject[p.id] || [],
          views: m.views ?? 0,
          likes: m.likes ?? 0,
          favorites: m.favorites ?? 0,
        };
      });

      res.json(list);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to list projects.');
  }
};

/**
 * Feed - public projects ranked (score | newest | popular)
 * GET /api/projects/feed?limit=20&sort=score|newest|popular
 */
exports.feed = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const sort = req.query.sort || 'score';

    const client = await pool.connect();
    try {
      let orderBy = 'COALESCE(m.views, 0) DESC, COALESCE(m.likes, 0) DESC, p.published_at DESC NULLS LAST';
      if (sort === 'newest') {
        orderBy = 'p.published_at DESC NULLS LAST, p.id DESC';
      } else if (sort === 'popular') {
        orderBy = 'COALESCE(m.likes, 0) DESC, COALESCE(m.views, 0) DESC';
      }
      // score = blueprint-style discovery (default: views + likes weighted)

      const projRes = await client.query(
        `SELECT p.id, p.owner_usn, p.title, p.short_description, p.description, p.category,
          p.hosted_url, p.github_url, p.mentor_name, p.tech_stack, p.published_at
         FROM projects p
         LEFT JOIN project_metrics m ON m.project_id = p.id
         WHERE p.visibility = 'PUBLIC' AND p.project_status = 'approved' AND p.published_at IS NOT NULL
         ORDER BY ${orderBy}
         LIMIT $1`,
        [limit]
      );
      const rows = projRes.rows || [];
      const projectIds = rows.map((r) => r.id);

      let coverByProj = {};
      if (projectIds.length > 0) {
        const assetRes = await client.query(
          `SELECT DISTINCT ON (project_id) project_id, original_url
           FROM project_assets
           WHERE project_id = ANY($1::bigint[]) AND asset_role IN ('COVER','GALLERY')
           ORDER BY project_id, position`,
          [projectIds]
        );
        (assetRes.rows || []).forEach((a) => {
          coverByProj[a.project_id] = a.original_url;
        });
      }

      const feed = rows.map((p, i) => ({
        id: p.id,
        owner_usn: p.owner_usn,
        title: p.title,
        short_description: p.short_description,
        description: p.description,
        category: p.category,
        hosted_url: p.hosted_url,
        github_url: p.github_url,
        mentor_name: p.mentor_name,
        tech_stack: Array.isArray(p.tech_stack) ? p.tech_stack : [],
        published_at: p.published_at,
        cover_url: coverByProj[p.id] || null,
        rank: i + 1,
      }));

      // Attach metrics for each
      const metricRes = await client.query(
        'SELECT project_id, views, likes FROM project_metrics WHERE project_id = ANY($1::bigint[])',
        [projectIds]
      );
      const metricMap = {};
      (metricRes.rows || []).forEach((m) => {
        metricMap[m.project_id] = m;
      });
      feed.forEach((f) => {
        const m = metricMap[f.id] || {};
        f.views = m.views ?? 0;
        f.likes = m.likes ?? 0;
      });

      res.json(feed);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to load feed.');
  }
};

/**
 * Get one project by id
 * GET /api/projects/:id?include_rank=true
 */
exports.getOne = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    const includeRank = req.query.include_rank === 'true';

    const client = await pool.connect();
    try {
      const project = await loadProject(client, projectId, { forUserId: userId });
      if (!project) {
        return sendNotFound(res, 'Project not found.');
      }

      const visibility = project.visibility || 'PRIVATE';
      const status = project.project_status;
      const isOwner = userId && (project.owner_user_id === userId || req.user?.usn?.toUpperCase() === project.owner_usn?.toUpperCase());

      if (!isOwner) {
        if (visibility === 'PRIVATE') {
          return sendNotFound(res, 'Project not found.');
        }
        if (status !== 'approved' && !project.published_at) {
          return sendNotFound(res, 'Project not found.');
        }
      }

      if (includeRank && visibility === 'PUBLIC' && status === 'approved') {
        const rankRes = await client.query(
          `SELECT COUNT(*)::int as total FROM projects p
           JOIN project_metrics m ON m.project_id = p.id
           WHERE p.visibility = 'PUBLIC' AND p.project_status = 'approved' AND p.published_at IS NOT NULL
           AND (m.views > (SELECT views FROM project_metrics WHERE project_id = $1)
                OR (m.views = (SELECT views FROM project_metrics WHERE project_id = $1) AND p.id <= $1))`,
          [projectId]
        );
        project.rank = rankRes.rows[0]?.total ?? 0;
        const totalRes = await client.query(
          `SELECT COUNT(*)::int as total FROM projects WHERE visibility = 'PUBLIC' AND project_status = 'approved' AND published_at IS NOT NULL`
        );
        project.total_public = totalRes.rows[0]?.total ?? 0;
      }

      res.json(project);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to load project.');
  }
};

/**
 * Create project
 * POST /api/projects
 */
exports.create = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?.user_id;
    const usn = req.user?.usn;
    if (!userId || !usn) {
      return sendError(res, 403, 'Only students can create projects.');
    }

    const body = req.body || {};
    const title = (body.title || '').trim();
    if (!title) {
      return sendValidationError(res, 'Title is required.', { title: 'Title is required.' });
    }

    const short_description = (body.short_description || '').trim() || title.slice(0, 200);
    const description = (body.description || '').trim() || null;
    const category = (body.category || '').trim() || null;
    const tags = Array.isArray(body.tags) ? body.tags : [];
    const visibility = (body.visibility || 'PRIVATE').toString().toUpperCase().trim();
    const hosted_url = (body.hosted_url || '').trim() || null;
    const github_url = (body.github_url || '').trim() || null;
    const mentor_name = (body.mentor_name || '').trim() || null;
    const tech_stack = Array.isArray(body.tech_stack) ? body.tech_stack : [];
    const priority = body.priority != null ? parseInt(body.priority, 10) : null;

    if (!VALID_VISIBILITY.includes(visibility)) {
      return sendValidationError(res, 'Invalid visibility.', { visibility: `Must be one of: ${VALID_VISIBILITY.join(', ')}` });
    }

    const client = await pool.connect();
    try {
      const insertRes = await client.query(
        `INSERT INTO projects (owner_usn, owner_user_id, title, short_description, description, category, tags, visibility, hosted_url, github_url, mentor_name, tech_stack, priority, project_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'not_approved')
         RETURNING id, owner_usn, title, short_description, description, category, visibility, hosted_url, github_url, mentor_name, tech_stack, priority, project_status, created_at`,
        [
          usn.toUpperCase(),
          userId,
          title,
          short_description,
          description,
          category,
          tags,
          visibility,
          hosted_url,
          github_url,
          mentor_name,
          tech_stack,
          Number.isNaN(priority) ? null : priority,
        ]
      );
      const proj = insertRes.rows[0];

      await client.query(
        `INSERT INTO project_metrics (project_id, views, likes, favorites, comments)
         VALUES ($1, 0, 0, 0, 0)
         ON CONFLICT (project_id) DO NOTHING`,
        [proj.id]
      );

      await ensureShareLink(client, proj.id);

      res.status(201).json({
        id: proj.id,
        owner_usn: proj.owner_usn,
        owner_user_id: proj.owner_user_id,
        title: proj.title,
        short_description: proj.short_description,
        description: proj.description,
        category: proj.category,
        tags: proj.tags || [],
        visibility: proj.visibility,
        hosted_url: proj.hosted_url,
        github_url: proj.github_url,
        mentor_name: proj.mentor_name,
        tech_stack: proj.tech_stack || [],
        priority: proj.priority,
        project_status: proj.project_status,
        created_at: proj.created_at,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to create project.');
  }
};

/**
 * Update project
 * PATCH /api/projects/:id
 */
exports.update = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    const usn = req.user?.usn;
    if (!userId && !usn) {
      return sendError(res, 401, 'Authentication required.');
    }

    const client = await pool.connect();
    try {
      const ownership = await assertOwnership(client, projectId, userId, usn);
      if (!ownership.ok) {
        if (ownership.error === 'not_found') return sendNotFound(res, 'Project not found.');
        return sendAccessDenied(res, 'You can only edit your own projects.');
      }

      const body = req.body || {};
      const updates = [];
      const values = [];
      let idx = 1;

      const allowed = ['title', 'short_description', 'description', 'category', 'tags', 'visibility', 'hosted_url', 'github_url', 'mentor_name', 'tech_stack', 'priority'];
      for (const field of allowed) {
        if (body[field] === undefined) continue;
        if (field === 'tags' || field === 'tech_stack') {
          updates.push(`${field} = $${idx}`);
          values.push(Array.isArray(body[field]) ? body[field] : []);
        } else if (field === 'visibility') {
          const v = (body[field] || 'PRIVATE').toString().toUpperCase().trim();
          if (!VALID_VISIBILITY.includes(v)) continue;
          updates.push(`${field} = $${idx}`);
          values.push(v);
        } else if (field === 'priority') {
          const p = body[field];
          if (p !== null && p !== undefined) {
            updates.push(`${field} = $${idx}`);
            values.push(parseInt(body[field], 10));
          }
        } else {
          updates.push(`${field} = $${idx}`);
          values.push(typeof body[field] === 'string' ? body[field].trim() : body[field]);
        }
        idx++;
      }

      if (updates.length === 0) {
        const project = await loadProject(client, projectId, { forUserId: userId });
        return res.json(project);
      }

      updates.push(`updated_at = NOW()`);
      values.push(projectId);
      await client.query(
        `UPDATE projects SET ${updates.join(', ')} WHERE id = $${idx}`,
        values
      );

      const project = await loadProject(client, projectId, { forUserId: userId });
      res.json(project);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to update project.');
  }
};

/**
 * Delete project
 * DELETE /api/projects/:id
 */
exports.delete = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    const usn = req.user?.usn;
    if (!userId && !usn) {
      return sendError(res, 401, 'Authentication required.');
    }

    const client = await pool.connect();
    try {
      const ownership = await assertOwnership(client, projectId, userId, usn);
      if (!ownership.ok) {
        if (ownership.error === 'not_found') return sendNotFound(res, 'Project not found.');
        return sendAccessDenied(res, 'You can only delete your own projects.');
      }

      await client.query('DELETE FROM project_asset_variants WHERE asset_id IN (SELECT id FROM project_assets WHERE project_id = $1)', [projectId]);
      await client.query('DELETE FROM project_assets WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_favorites WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_likes WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_reviews WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_share_links WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_views WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_metrics WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM projects WHERE id = $1', [projectId]);

      res.status(204).send();
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to delete project.');
  }
};

/**
 * Submit project for approval
 * PATCH /api/projects/:id/submit
 */
exports.submit = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    const usn = req.user?.usn;
    if (!userId && !usn) {
      return sendError(res, 401, 'Authentication required.');
    }

    const client = await pool.connect();
    try {
      const ownership = await assertOwnership(client, projectId, userId, usn);
      if (!ownership.ok) {
        if (ownership.error === 'not_found') return sendNotFound(res, 'Project not found.');
        return sendAccessDenied(res, 'Only owner can submit.');
      }

      const r = await client.query('SELECT project_status FROM projects WHERE id = $1', [projectId]);
      if (!r.rows.length) return sendNotFound(res, 'Project not found.');
      const status = r.rows[0].project_status;

      if (status !== 'not_approved' && status !== 'rejected') {
        return sendValidationError(res, 'Project can only be submitted when not yet approved or when rejected (resubmit).');
      }

      await client.query(
        "UPDATE projects SET project_status = 'not_approved', updated_at = NOW() WHERE id = $1",
        [projectId]
      );

      const project = await loadProject(client, projectId, { forUserId: userId });
      res.json(project);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to submit project.');
  }
};

/**
 * Publish project (requires approved status)
 * PATCH /api/projects/:id/publish
 */
exports.publish = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    const usn = req.user?.usn;
    if (!userId && !usn) {
      return sendError(res, 401, 'Authentication required.');
    }

    const client = await pool.connect();
    try {
      const ownership = await assertOwnership(client, projectId, userId, usn);
      if (!ownership.ok) {
        if (ownership.error === 'not_found') return sendNotFound(res, 'Project not found.');
        return sendAccessDenied(res, 'Only owner can publish.');
      }

      const r = await client.query('SELECT project_status FROM projects WHERE id = $1', [projectId]);
      if (!r.rows.length) return sendNotFound(res, 'Project not found.');
      const status = r.rows[0].project_status;

      if (status !== 'approved') {
        return sendValidationError(res, 'Project must be approved by admin before publishing.');
      }

      await client.query(
        "UPDATE projects SET visibility = 'PUBLIC', published_at = NOW(), updated_at = NOW() WHERE id = $1",
        [projectId]
      );

      const project = await loadProject(client, projectId, { forUserId: userId });
      res.json(project);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to publish project.');
  }
};

/**
 * Add asset
 * POST /api/projects/:id/assets
 */
exports.addAsset = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    const usn = req.user?.usn;
    if (!userId && !usn) {
      return sendError(res, 401, 'Authentication required.');
    }

    const body = req.body || {};
    const original_url = (body.original_url || '').trim();
    if (!original_url) {
      return sendValidationError(res, 'original_url is required.', { original_url: 'Asset URL is required.' });
    }
    const asset_type = (body.asset_type || 'IMAGE').toUpperCase();
    const asset_role = (body.asset_role || 'GALLERY').toUpperCase();
    const position = body.position != null ? parseInt(body.position, 10) : 0;
    const width = body.width != null ? parseInt(body.width, 10) : null;
    const height = body.height != null ? parseInt(body.height, 10) : null;
    const file_size_kb = body.file_size_kb != null ? parseInt(body.file_size_kb, 10) : null;
    const mime_type = (body.mime_type || '').trim() || null;

    if (!VALID_ASSET_TYPES.includes(asset_type)) {
      return sendValidationError(res, 'Invalid asset_type.', { asset_type: `Must be one of: ${VALID_ASSET_TYPES.join(', ')}` });
    }
    if (!VALID_ASSET_ROLES.includes(asset_role)) {
      return sendValidationError(res, 'Invalid asset_role.', { asset_role: `Must be one of: ${VALID_ASSET_ROLES.join(', ')}` });
    }

    const client = await pool.connect();
    try {
      const ownership = await assertOwnership(client, projectId, userId, usn);
      if (!ownership.ok) {
        if (ownership.error === 'not_found') return sendNotFound(res, 'Project not found.');
        return sendAccessDenied(res, 'Only owner can add assets.');
      }

      const insertRes = await client.query(
        `INSERT INTO project_assets (project_id, asset_type, asset_role, original_url, width, height, file_size_kb, mime_type, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, project_id, asset_type, asset_role, original_url, position`,
        [projectId, asset_type, asset_role, original_url, width, height, file_size_kb, mime_type, position]
      );
      const asset = insertRes.rows[0];
      if (asset_type === 'IMAGE') {
        enqueueVariantJob(asset.id, original_url);
      }
      res.status(201).json(asset);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to add asset.');
  }
};

/**
 * Delete asset
 * DELETE /api/projects/:id/assets/:assetId
 */
exports.deleteAsset = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const assetId = parseInt(req.params.assetId, 10);
    if (Number.isNaN(projectId) || Number.isNaN(assetId)) {
      return sendValidationError(res, 'Invalid project or asset id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    const usn = req.user?.usn;
    if (!userId && !usn) {
      return sendError(res, 401, 'Authentication required.');
    }

    const client = await pool.connect();
    try {
      const ownership = await assertOwnership(client, projectId, userId, usn);
      if (!ownership.ok) {
        if (ownership.error === 'not_found') return sendNotFound(res, 'Project not found.');
        return sendAccessDenied(res, 'Only owner can delete assets.');
      }

      const checkRes = await client.query(
        'SELECT id FROM project_assets WHERE project_id = $1 AND id = $2',
        [projectId, assetId]
      );
      if (!checkRes.rows.length) {
        return sendNotFound(res, 'Asset not found.');
      }

      await client.query('DELETE FROM project_asset_variants WHERE asset_id = $1', [assetId]);
      await client.query('DELETE FROM project_assets WHERE id = $1', [assetId]);
      res.status(204).send();
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to delete asset.');
  }
};

/**
 * Create share link (get-or-create: each project has one permanent link, no expiry)
 * POST /api/projects/:id/share
 */
exports.createShareLink = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    const usn = req.user?.usn;
    if (!userId && !usn) {
      return sendError(res, 401, 'Authentication required.');
    }

    const client = await pool.connect();
    try {
      const ownership = await assertOwnership(client, projectId, userId, usn);
      if (!ownership.ok) {
        if (ownership.error === 'not_found') return sendNotFound(res, 'Project not found.');
        return sendAccessDenied(res, 'Only owner can create share links.');
      }

      const projRes = await client.query('SELECT id FROM projects WHERE id = $1', [projectId]);
      if (!projRes.rows.length) {
        return sendNotFound(res, 'Project not found.');
      }

      const { share_token: shareToken } = await ensureShareLink(client, projectId);
      const path = `/projects/share/${shareToken}`;
      res.status(200).json({
        share_token: shareToken,
        url: path,
        expires_at: null,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to create share link.');
  }
};

/**
 * Get project by share token (public)
 * GET /api/projects/share/:token
 */
exports.getByShareToken = async (req, res) => {
  try {
    const token = (req.params.token || '').trim();
    if (!token) {
      return sendNotFound(res, 'Share link not found.');
    }

    const client = await pool.connect();
    try {
      const linkRes = await client.query(
        `SELECT psl.project_id, psl.expires_at, psl.is_active
         FROM project_share_links psl
         WHERE psl.share_token = $1`,
        [token]
      );
      if (!linkRes.rows.length) {
        return sendNotFound(res, 'Invalid or expired share link.');
      }
      const link = linkRes.rows[0];
      if (!link.is_active) {
        return sendNotFound(res, 'Share link is no longer active.');
      }
      if (link.expires_at && new Date(link.expires_at) < new Date()) {
        return sendNotFound(res, 'Share link has expired.');
      }

      const projectId = link.project_id;
      const project = await loadProject(client, projectId, {});
      if (!project) {
        return sendNotFound(res, 'Project not found.');
      }

      res.json(project);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to load shared project.');
  }
};

/**
 * Add review
 * POST /api/projects/:id/reviews
 */
exports.addReview = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) {
      return sendError(res, 401, 'Authentication required.');
    }

    const review_text = (req.body?.review_text || '').trim();
    if (!review_text) {
      return sendValidationError(res, 'review_text is required.', { review_text: 'Review text is required.' });
    }

    const client = await pool.connect();
    try {
      const projRes = await client.query(
        'SELECT id, owner_user_id, visibility, project_status FROM projects WHERE id = $1',
        [projectId]
      );
      if (!projRes.rows.length) {
        return sendNotFound(res, 'Project not found.');
      }
      const p = projRes.rows[0];

      const canView = p.visibility === 'PUBLIC' || p.project_status === 'approved';
      if (!canView) {
        return sendNotFound(res, 'Project not found.');
      }

      const ownerUserId = p.owner_user_id;
      const insertRes = await client.query(
        `INSERT INTO project_reviews (project_id, reviewer_id, owner_id, review_text)
         VALUES ($1, $2, $3, $4)
         RETURNING id, project_id, reviewer_id, review_text, review_created_at`,
        [projectId, userId, ownerUserId, review_text]
      );

      await client.query(
        `UPDATE project_metrics SET comments = comments + 1, last_updated = NOW() WHERE project_id = $1`,
        [projectId]
      );

      res.status(201).json(insertRes.rows[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to add review.');
  }
};

/**
 * Reply to review (owner only)
 * PATCH /api/projects/:id/reviews/:reviewId
 */
exports.replyReview = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const reviewId = parseInt(req.params.reviewId, 10);
    if (Number.isNaN(projectId) || Number.isNaN(reviewId)) {
      return sendValidationError(res, 'Invalid project or review id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    const usn = req.user?.usn;
    if (!userId && !usn) {
      return sendError(res, 401, 'Authentication required.');
    }

    const reply_text = (req.body?.reply_text || '').trim();
    if (!reply_text) {
      return sendValidationError(res, 'reply_text is required.', { reply_text: 'Reply text is required.' });
    }

    const client = await pool.connect();
    try {
      const ownership = await assertOwnership(client, projectId, userId, usn);
      if (!ownership.ok) {
        if (ownership.error === 'not_found') return sendNotFound(res, 'Project not found.');
        return sendAccessDenied(res, 'Only owner can reply to reviews.');
      }

      const updateRes = await client.query(
        `UPDATE project_reviews SET reply_text = $1, reply_created_at = NOW() WHERE id = $2 AND project_id = $3
         RETURNING id, reply_text, reply_created_at`,
        [reply_text, reviewId, projectId]
      );
      if (!updateRes.rows.length) {
        return sendNotFound(res, 'Review not found.');
      }
      res.json(updateRes.rows[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to reply to review.');
  }
};

/**
 * Toggle like
 * POST /api/projects/:id/like
 */
exports.toggleLike = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) {
      return sendError(res, 401, 'Authentication required.');
    }

    const client = await pool.connect();
    try {
      const projRes = await client.query(
        'SELECT id, owner_user_id, visibility, project_status FROM projects WHERE id = $1',
        [projectId]
      );
      if (!projRes.rows.length) {
        return sendNotFound(res, 'Project not found.');
      }
      const p = projRes.rows[0];
      const canView = p.visibility === 'PUBLIC' || p.project_status === 'approved';
      if (!canView) {
        return sendNotFound(res, 'Project not found.');
      }

      const existRes = await client.query(
        'SELECT 1 FROM project_likes WHERE project_id = $1 AND user_id = $2',
        [projectId, userId]
      );
      const existed = !!existRes.rows.length;

      // Ensure project_metrics row exists (some projects may not have one)
      await client.query(
        `INSERT INTO project_metrics (project_id, views, likes, favorites, comments)
         VALUES ($1, 0, 0, 0, 0)
         ON CONFLICT (project_id) DO NOTHING`,
        [projectId]
      );

      if (existed) {
        await client.query('DELETE FROM project_likes WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
        await client.query(
          'UPDATE project_metrics SET likes = GREATEST(0, likes - 1), last_updated = NOW() WHERE project_id = $1',
          [projectId]
        );
      } else {
        await client.query(
          'INSERT INTO project_likes (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [projectId, userId]
        );
        await client.query(
          'UPDATE project_metrics SET likes = likes + 1, last_updated = NOW() WHERE project_id = $1',
          [projectId]
        );
      }

      const metricRes = await client.query(
        'SELECT likes FROM project_metrics WHERE project_id = $1',
        [projectId]
      );
      const likes = metricRes.rows[0]?.likes ?? 0;
      const newLiked = !existed;

      res.json({ liked: newLiked, likes });
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to toggle like.');
  }
};

/**
 * Toggle favorite
 * POST /api/projects/:id/favorite
 */
exports.toggleFavorite = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) {
      return sendError(res, 401, 'Authentication required.');
    }

    const client = await pool.connect();
    try {
      const projRes = await client.query(
        'SELECT id, visibility, project_status FROM projects WHERE id = $1',
        [projectId]
      );
      if (!projRes.rows.length) {
        return sendNotFound(res, 'Project not found.');
      }
      const p = projRes.rows[0];
      const canView = p.visibility === 'PUBLIC' || p.project_status === 'approved';
      if (!canView) {
        return sendNotFound(res, 'Project not found.');
      }

      const existRes = await client.query(
        'SELECT 1 FROM project_favorites WHERE project_id = $1 AND user_id = $2',
        [projectId, userId]
      );
      const existed = !!existRes.rows.length;

      // Ensure project_metrics row exists (some projects may not have one)
      await client.query(
        `INSERT INTO project_metrics (project_id, views, likes, favorites, comments)
         VALUES ($1, 0, 0, 0, 0)
         ON CONFLICT (project_id) DO NOTHING`,
        [projectId]
      );

      if (existed) {
        await client.query('DELETE FROM project_favorites WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
        await client.query(
          'UPDATE project_metrics SET favorites = GREATEST(0, favorites - 1), last_updated = NOW() WHERE project_id = $1',
          [projectId]
        );
      } else {
        await client.query(
          'INSERT INTO project_favorites (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [projectId, userId]
        );
        await client.query(
          'UPDATE project_metrics SET favorites = favorites + 1, last_updated = NOW() WHERE project_id = $1',
          [projectId]
        );
      }

      const metricRes = await client.query(
        'SELECT favorites FROM project_metrics WHERE project_id = $1',
        [projectId]
      );
      const favorites = metricRes.rows[0]?.favorites ?? 0;
      const newFavorited = !existed;

      res.json({ favorited: newFavorited, favorites });
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to toggle favorite.');
  }
};

/**
 * Admin: list all projects
 * GET /api/admin/projects?search=...&project_status=...
 */
exports.adminList = async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const projectStatus = (req.query.project_status || '').trim().toLowerCase();

    const client = await pool.connect();
    try {
      let sql = `SELECT p.id, p.owner_usn as usn, p.owner_user_id, p.title, p.short_description as one_line_description,
        p.description as full_description, p.category as genre, p.visibility, p.hosted_url as hosted_link,
        p.github_url as github_repo, p.mentor_name, p.tech_stack as technologies, p.project_status,
        p.priority, p.published_at, p.created_at, p.updated_at
        FROM projects p WHERE 1=1`;
      const params = [];
      let idx = 1;

      if (search) {
        sql += ` AND (p.title ILIKE $${idx} OR p.owner_usn ILIKE $${idx} OR p.category ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }
      if (projectStatus && VALID_PROJECT_STATUS.includes(projectStatus)) {
        sql += ` AND p.project_status = $${idx}`;
        params.push(projectStatus);
        idx++;
      }

      sql += ` ORDER BY p.created_at DESC`;

      const projRes = await client.query(sql, params);
      const rows = projRes.rows || [];
      const projectIds = rows.map((r) => r.id);

      let assets = [];
      let metricsByProj = {};
      let likedProjectIds = new Set();
      let favoritedProjectIds = new Set();
      const userId = req.user?.id ?? req.user?.user_id;

      if (projectIds.length > 0) {
        const queries = [
          client.query(
            'SELECT project_id, original_url, position FROM project_assets WHERE project_id = ANY($1::bigint[]) ORDER BY project_id, position',
            [projectIds]
          ),
          client.query(
            'SELECT project_id, views, likes, favorites FROM project_metrics WHERE project_id = ANY($1::bigint[])',
            [projectIds]
          ),
        ];
        if (userId) {
          queries.push(
            client.query(
              'SELECT project_id FROM project_likes WHERE project_id = ANY($1::bigint[]) AND user_id = $2',
              [projectIds, userId]
            ),
            client.query(
              'SELECT project_id FROM project_favorites WHERE project_id = ANY($1::bigint[]) AND user_id = $2',
              [projectIds, userId]
            )
          );
        }
        const results = await Promise.all(queries);
        assets = results[0].rows || [];
        (results[1].rows || []).forEach((m) => {
          metricsByProj[m.project_id] = m;
        });
        if (userId && results[2]) {
          (results[2].rows || []).forEach((r) => likedProjectIds.add(r.project_id));
        }
        if (userId && results[3]) {
          (results[3].rows || []).forEach((r) => favoritedProjectIds.add(r.project_id));
        }
      }

      const byProject = {};
      assets.forEach((a) => {
        if (!byProject[a.project_id]) byProject[a.project_id] = [];
        byProject[a.project_id].push(a.original_url);
      });

      const list = rows.map((p) => {
        const m = metricsByProj[p.id] || {};
        return {
          id: p.id,
          usn: p.usn,
          title: p.title,
          one_line_description: p.one_line_description,
          full_description: p.full_description,
          genre: p.genre,
          visibility: p.visibility,
          hosted_link: p.hosted_link,
          github_repo: p.github_repo,
          mentor_name: p.mentor_name,
          technologies: Array.isArray(p.technologies) ? p.technologies : [],
          project_status: p.project_status,
          project_snaps: byProject[p.id] || [],
          views_count: m.views ?? 0,
          likes_count: m.likes ?? 0,
          favorites_count: m.favorites ?? 0,
          is_liked: likedProjectIds.has(p.id),
          is_favorited: favoritedProjectIds.has(p.id),
          is_approved: p.project_status === 'approved',
        };
      });

      res.json(list);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to list projects.');
  }
};

/**
 * Admin: update project (status)
 * PATCH /api/admin/projects/:id
 */
exports.adminUpdate = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) {
      return sendError(res, 401, 'Authentication required.');
    }

    const body = req.body || {};
    let projectStatus = body.project_status;
    if (projectStatus === undefined && body.is_approved !== undefined) {
      projectStatus = body.is_approved ? 'approved' : 'rejected';
    }

    const client = await pool.connect();
    try {
      const projRes = await client.query(
        'SELECT id, owner_user_id FROM projects WHERE id = $1',
        [projectId]
      );
      if (!projRes.rows.length) {
        return sendNotFound(res, 'Project not found.');
      }

      if (projectStatus && VALID_PROJECT_STATUS.includes(projectStatus)) {
        await client.query(
          'UPDATE projects SET project_status = $1, updated_at = NOW() WHERE id = $2',
          [projectStatus, projectId]
        );
      }

      const project = await loadProject(client, projectId, {});
      res.json(project);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to update project.');
  }
};

/** Admin: assert project exists (no ownership check - admin has full access) */
async function assertProjectExists(client, projectId) {
  const r = await client.query('SELECT id FROM projects WHERE id = $1', [projectId]);
  return r.rows.length > 0;
}

/**
 * Admin: get full project by id with all sub-tables
 * GET /api/admin/projects/:id
 */
exports.adminGetById = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }

    const client = await pool.connect();
    try {
      const projRes = await client.query(
        `SELECT p.id, p.owner_usn, p.owner_user_id, p.title, p.short_description, p.description,
          p.category, p.tags, p.visibility, p.hosted_url, p.github_url, p.mentor_name,
          p.tech_stack, p.published_at, p.created_at, p.updated_at, p.priority, p.project_status
         FROM projects p WHERE p.id = $1`,
        [projectId]
      );
      if (!projRes.rows.length) {
        return sendNotFound(res, 'Project not found.');
      }
      const p = projRes.rows[0];

      const [assetsRes, variantsRes, metricsRes, reviewsRes, shareLinksRes] = await Promise.all([
        client.query(
          'SELECT id, asset_type, asset_role, original_url, position, width, height, file_size_kb, mime_type, uploaded_at FROM project_assets WHERE project_id = $1 ORDER BY position',
          [projectId]
        ),
        client.query(
          `SELECT v.id, v.asset_id, v.variant_type, v.width, v.height, v.quality, v.variant_url, v.file_size_kb, v.created_at
           FROM project_asset_variants v
           JOIN project_assets a ON a.id = v.asset_id AND a.project_id = $1
           ORDER BY v.asset_id, v.variant_type`,
          [projectId]
        ),
        client.query(
          'SELECT views, likes, favorites, comments, last_updated FROM project_metrics WHERE project_id = $1',
          [projectId]
        ),
        client.query(
          `SELECT r.id, r.reviewer_id, r.owner_id, r.review_text, r.review_created_at, r.reply_text, r.reply_created_at,
                  u.usn AS reviewer_usn
           FROM project_reviews r
           LEFT JOIN user_login u ON u.id = r.reviewer_id
           WHERE r.project_id = $1 ORDER BY r.review_created_at DESC`,
          [projectId]
        ),
        client.query(
          'SELECT id, share_token, expires_at, is_active, created_at FROM project_share_links WHERE project_id = $1 ORDER BY created_at DESC',
          [projectId]
        ),
      ]);

      const assets = assetsRes.rows || [];
      const variants = variantsRes.rows || [];
      let metrics = metricsRes.rows[0] || null;
      if (!metrics) {
        const fallbackRes = await client.query(
          `SELECT
            (SELECT COUNT(*)::int FROM project_views WHERE project_id = $1) AS views,
            (SELECT COUNT(*)::int FROM project_likes WHERE project_id = $1) AS likes,
            (SELECT COUNT(*)::int FROM project_favorites WHERE project_id = $1) AS favorites,
            (SELECT COUNT(*)::int FROM project_reviews WHERE project_id = $1) AS comments`,
          [projectId]
        );
        metrics = { ...(fallbackRes.rows[0] || {}), last_updated: null };
      }
      metrics = {
        views: metrics.views ?? 0,
        likes: metrics.likes ?? 0,
        favorites: metrics.favorites ?? 0,
        comments: metrics.comments ?? 0,
        last_updated: metrics.last_updated ?? null,
      };
      const reviews = reviewsRes.rows || [];
      const shareLinks = shareLinksRes.rows || [];

      const variantsByAsset = {};
      variants.forEach((v) => {
        if (!variantsByAsset[v.asset_id]) variantsByAsset[v.asset_id] = [];
        variantsByAsset[v.asset_id].push({
          id: v.id,
          variant_type: v.variant_type,
          width: v.width,
          height: v.height,
          quality: v.quality,
          variant_url: v.variant_url,
          file_size_kb: v.file_size_kb,
          created_at: v.created_at,
        });
      });

      const assetsWithVariants = assets.map((a) => ({
        id: a.id,
        asset_type: a.asset_type,
        asset_role: a.asset_role,
        original_url: a.original_url,
        position: a.position,
        width: a.width,
        height: a.height,
        file_size_kb: a.file_size_kb,
        mime_type: a.mime_type,
        uploaded_at: a.uploaded_at,
        variants: variantsByAsset[a.id] || [],
      }));

      const project_snaps = assets
        .filter((a) => ['COVER', 'GALLERY'].includes(a.asset_role))
        .sort((a, b) => a.position - b.position)
        .map((a) => a.original_url);

      res.json({
        id: p.id,
        owner_usn: p.owner_usn,
        owner_user_id: p.owner_user_id,
        title: p.title,
        short_description: p.short_description,
        description: p.description,
        category: p.category,
        tags: Array.isArray(p.tags) ? p.tags : [],
        visibility: p.visibility || 'PRIVATE',
        hosted_url: p.hosted_url,
        github_url: p.github_url,
        mentor_name: p.mentor_name,
        tech_stack: Array.isArray(p.tech_stack) ? p.tech_stack : [],
        published_at: p.published_at,
        created_at: p.created_at,
        updated_at: p.updated_at,
        priority: p.priority,
        project_status: p.project_status,
        project_snaps,
        assets: assetsWithVariants,
        metrics: {
          views: metrics.views ?? 0,
          likes: metrics.likes ?? 0,
          favorites: metrics.favorites ?? 0,
          comments: metrics.comments ?? 0,
          last_updated: metrics.last_updated,
        },
        reviews,
        share_links: shareLinks,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to fetch project.');
  }
};

/**
 * Admin: delete project and all sub-tables
 * DELETE /api/admin/projects/:id
 */
exports.adminDelete = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }

    const client = await pool.connect();
    try {
      const exists = await assertProjectExists(client, projectId);
      if (!exists) return sendNotFound(res, 'Project not found.');

      await client.query('DELETE FROM project_asset_variants WHERE asset_id IN (SELECT id FROM project_assets WHERE project_id = $1)', [projectId]);
      await client.query('DELETE FROM project_assets WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_favorites WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_likes WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_reviews WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_share_links WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_views WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_metrics WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM projects WHERE id = $1', [projectId]);

      res.status(204).send();
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to delete project.');
  }
};

/**
 * Admin: add asset to project
 * POST /api/admin/projects/:id/assets
 */
exports.adminAddAsset = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }

    const body = req.body || {};
    const original_url = (body.original_url || '').trim();
    if (!original_url) {
      return sendValidationError(res, 'original_url is required.', { original_url: 'Asset URL is required.' });
    }
    const asset_type = (body.asset_type || 'IMAGE').toUpperCase();
    const asset_role = (body.asset_role || 'GALLERY').toUpperCase();
    const position = body.position != null ? parseInt(body.position, 10) : 0;
    const width = body.width != null ? parseInt(body.width, 10) : null;
    const height = body.height != null ? parseInt(body.height, 10) : null;
    const file_size_kb = body.file_size_kb != null ? parseInt(body.file_size_kb, 10) : null;
    const mime_type = (body.mime_type || '').trim() || null;

    if (!VALID_ASSET_TYPES.includes(asset_type)) {
      return sendValidationError(res, 'Invalid asset_type.', { asset_type: `Must be one of: ${VALID_ASSET_TYPES.join(', ')}` });
    }
    if (!VALID_ASSET_ROLES.includes(asset_role)) {
      return sendValidationError(res, 'Invalid asset_role.', { asset_role: `Must be one of: ${VALID_ASSET_ROLES.join(', ')}` });
    }

    const client = await pool.connect();
    try {
      const exists = await assertProjectExists(client, projectId);
      if (!exists) return sendNotFound(res, 'Project not found.');

      const insertRes = await client.query(
        `INSERT INTO project_assets (project_id, asset_type, asset_role, original_url, width, height, file_size_kb, mime_type, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, project_id, asset_type, asset_role, original_url, position`,
        [projectId, asset_type, asset_role, original_url, width, height, file_size_kb, mime_type, position]
      );
      const asset = insertRes.rows[0];
      if (asset_type === 'IMAGE') {
        enqueueVariantJob(asset.id, original_url);
      }
      res.status(201).json(asset);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to add asset.');
  }
};

/**
 * Admin: delete asset (and its variants)
 * DELETE /api/admin/projects/:id/assets/:assetId
 */
exports.adminDeleteAsset = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const assetId = parseInt(req.params.assetId, 10);
    if (Number.isNaN(projectId) || Number.isNaN(assetId)) {
      return sendValidationError(res, 'Invalid project or asset id.');
    }

    const client = await pool.connect();
    try {
      const checkRes = await client.query(
        'SELECT id FROM project_assets WHERE project_id = $1 AND id = $2',
        [projectId, assetId]
      );
      if (!checkRes.rows.length) return sendNotFound(res, 'Asset not found.');

      await client.query('DELETE FROM project_asset_variants WHERE asset_id = $1', [assetId]);
      await client.query('DELETE FROM project_assets WHERE id = $1', [assetId]);
      res.status(204).send();
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to delete asset.');
  }
};

/**
 * Admin: update asset (position, asset_role)
 * PATCH /api/admin/projects/:id/assets/:assetId
 */
exports.adminUpdateAsset = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const assetId = parseInt(req.params.assetId, 10);
    if (Number.isNaN(projectId) || Number.isNaN(assetId)) {
      return sendValidationError(res, 'Invalid project or asset id.');
    }

    const body = req.body || {};
    const updates = [];
    const values = [];
    let idx = 1;

    if (body.position != null) {
      updates.push(`position = $${idx}`);
      values.push(parseInt(body.position, 10));
      idx++;
    }
    if (body.asset_role && VALID_ASSET_ROLES.includes(body.asset_role.toUpperCase())) {
      updates.push(`asset_role = $${idx}`);
      values.push(body.asset_role.toUpperCase());
      idx++;
    }

    if (updates.length === 0) {
      return sendValidationError(res, 'No valid fields to update.');
    }

    const client = await pool.connect();
    try {
      const checkRes = await client.query(
        'SELECT id FROM project_assets WHERE project_id = $1 AND id = $2',
        [projectId, assetId]
      );
      if (!checkRes.rows.length) return sendNotFound(res, 'Asset not found.');

      values.push(assetId);
      await client.query(
        `UPDATE project_assets SET ${updates.join(', ')} WHERE id = $${idx}`,
        values
      );

      const assetRes = await client.query(
        'SELECT id, project_id, asset_type, asset_role, original_url, position FROM project_assets WHERE id = $1',
        [assetId]
      );
      res.json(assetRes.rows[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to update asset.');
  }
};

/**
 * Admin: list variants for an asset
 * GET /api/admin/projects/:id/assets/:assetId/variants
 */
exports.adminListVariants = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const assetId = parseInt(req.params.assetId, 10);
    if (Number.isNaN(projectId) || Number.isNaN(assetId)) {
      return sendValidationError(res, 'Invalid project or asset id.');
    }

    const client = await pool.connect();
    try {
      const checkRes = await client.query(
        'SELECT id FROM project_assets WHERE project_id = $1 AND id = $2',
        [projectId, assetId]
      );
      if (!checkRes.rows.length) return sendNotFound(res, 'Asset not found.');

      const variantsRes = await client.query(
        'SELECT id, asset_id, variant_type, width, height, quality, variant_url, file_size_kb, created_at FROM project_asset_variants WHERE asset_id = $1 ORDER BY variant_type',
        [assetId]
      );
      res.json(variantsRes.rows || []);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to list variants.');
  }
};

/**
 * Admin: delete a variant
 * DELETE /api/admin/projects/:id/assets/:assetId/variants/:variantId
 */
exports.adminDeleteVariant = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const assetId = parseInt(req.params.assetId, 10);
    const variantId = parseInt(req.params.variantId, 10);
    if (Number.isNaN(projectId) || Number.isNaN(assetId) || Number.isNaN(variantId)) {
      return sendValidationError(res, 'Invalid project, asset or variant id.');
    }

    const client = await pool.connect();
    try {
      const checkRes = await client.query(
        'SELECT id FROM project_assets WHERE project_id = $1 AND id = $2',
        [projectId, assetId]
      );
      if (!checkRes.rows.length) return sendNotFound(res, 'Asset not found.');

      const delRes = await client.query(
        'DELETE FROM project_asset_variants WHERE id = $1 AND asset_id = $2 RETURNING id',
        [variantId, assetId]
      );
      if (!delRes.rows.length) return sendNotFound(res, 'Variant not found.');
      res.status(204).send();
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to delete variant.');
  }
};

/**
 * Admin: list reviews for a project
 * GET /api/admin/projects/:id/reviews
 */
exports.adminListReviews = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }

    const client = await pool.connect();
    try {
      const exists = await assertProjectExists(client, projectId);
      if (!exists) return sendNotFound(res, 'Project not found.');

      const reviewsRes = await client.query(
        `SELECT r.id, r.reviewer_id, r.owner_id, r.review_text, r.review_created_at, r.reply_text, r.reply_created_at,
                u.usn AS reviewer_usn
         FROM project_reviews r
         LEFT JOIN user_login u ON u.id = r.reviewer_id
         WHERE r.project_id = $1 ORDER BY r.review_created_at DESC`,
        [projectId]
      );
      res.json(reviewsRes.rows || []);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to list reviews.');
  }
};

/**
 * Admin: add a review to a project
 * POST /api/admin/projects/:id/reviews
 */
exports.adminAddReview = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }
    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) {
      return sendError(res, 401, 'Authentication required.');
    }

    const review_text = (req.body?.review_text || '').trim();
    if (!review_text) {
      return sendValidationError(res, 'review_text is required.', { review_text: 'Review text is required.' });
    }

    const client = await pool.connect();
    try {
      const projRes = await client.query(
        'SELECT id, owner_user_id, project_status FROM projects WHERE id = $1',
        [projectId]
      );
      if (!projRes.rows.length) {
        return sendNotFound(res, 'Project not found.');
      }
      const ownerUserId = projRes.rows[0].owner_user_id;
      const projectStatus = projRes.rows[0].project_status;
      if (projectStatus !== 'approved') {
        return sendError(res, 400, 'Reviews can only be added when the project is approved.');
      }

      const insertRes = await client.query(
        `INSERT INTO project_reviews (project_id, reviewer_id, owner_id, review_text)
         VALUES ($1, $2, $3, $4)
         RETURNING id, project_id, reviewer_id, review_text, review_created_at, reply_text, reply_created_at`,
        [projectId, userId, ownerUserId, review_text]
      );

      const reviewerUsn = req.user?.usn ?? null;
      const row = insertRes.rows[0];
      const reviewPayload = row ? { ...row, reviewer_usn: reviewerUsn } : row;

      await client.query(
        `INSERT INTO project_metrics (project_id, views, likes, favorites, comments, last_updated)
         VALUES ($1, 0, 0, 0, 1, NOW())
         ON CONFLICT (project_id) DO UPDATE SET comments = COALESCE(project_metrics.comments, 0) + 1, last_updated = NOW()`,
        [projectId]
      );

      res.status(201).json(reviewPayload);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to add review.');
  }
};

/**
 * Admin: delete a review
 * DELETE /api/admin/projects/:id/reviews/:reviewId
 */
exports.adminDeleteReview = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const reviewId = parseInt(req.params.reviewId, 10);
    if (Number.isNaN(projectId) || Number.isNaN(reviewId)) {
      return sendValidationError(res, 'Invalid project or review id.');
    }

    const client = await pool.connect();
    try {
      const delRes = await client.query(
        'DELETE FROM project_reviews WHERE id = $1 AND project_id = $2 RETURNING id',
        [reviewId, projectId]
      );
      if (!delRes.rows.length) return sendNotFound(res, 'Review not found.');
      await client.query(
        `UPDATE project_metrics SET comments = GREATEST(0, comments - 1), last_updated = NOW() WHERE project_id = $1`,
        [projectId]
      );
      res.status(204).send();
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to delete review.');
  }
};

/**
 * Admin: list share links for a project
 * GET /api/admin/projects/:id/share-links
 */
exports.adminListShareLinks = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }

    const client = await pool.connect();
    try {
      const exists = await assertProjectExists(client, projectId);
      if (!exists) return sendNotFound(res, 'Project not found.');

      const linksRes = await client.query(
        'SELECT id, share_token, expires_at, is_active, created_at FROM project_share_links WHERE project_id = $1 ORDER BY created_at DESC',
        [projectId]
      );
      res.json(linksRes.rows || []);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to list share links.');
  }
};

/**
 * Admin: create share link
 * POST /api/admin/projects/:id/share-links
 */
exports.adminCreateShareLink = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return sendValidationError(res, 'Invalid project id.');
    }

    const expires_in_hours = req.body?.expires_in_hours != null ? parseInt(req.body.expires_in_hours, 10) : 168;
    const expiresAt = expires_in_hours > 0
      ? new Date(Date.now() + expires_in_hours * 60 * 60 * 1000)
      : null;

    const client = await pool.connect();
    try {
      const exists = await assertProjectExists(client, projectId);
      if (!exists) return sendNotFound(res, 'Project not found.');

      const shareToken = crypto.randomBytes(24).toString('hex');
      await client.query(
        `INSERT INTO project_share_links (project_id, share_token, expires_at, is_active)
         VALUES ($1, $2, $3, true)`,
        [projectId, shareToken, expiresAt]
      );

      const linkRes = await client.query(
        'SELECT id, share_token, expires_at, is_active, created_at FROM project_share_links WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
        [projectId]
      );
      res.status(201).json(linkRes.rows[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to create share link.');
  }
};

/**
 * Admin: delete share link
 * DELETE /api/admin/projects/:id/share-links/:linkId
 */
exports.adminDeleteShareLink = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const linkId = parseInt(req.params.linkId, 10);
    if (Number.isNaN(projectId) || Number.isNaN(linkId)) {
      return sendValidationError(res, 'Invalid project or link id.');
    }

    const client = await pool.connect();
    try {
      const delRes = await client.query(
        'DELETE FROM project_share_links WHERE id = $1 AND project_id = $2 RETURNING id',
        [linkId, projectId]
      );
      if (!delRes.rows.length) return sendNotFound(res, 'Link not found.');
      res.status(204).send();
    } finally {
      client.release();
    }
  } catch (error) {
    return sendCaughtError(res, error, 'Failed to delete share link.');
  }
};

exports.ensureShareLink = ensureShareLink;
