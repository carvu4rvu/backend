/**
 * Projects API (new): uses `projects` table and owner_user_id.
 * Separate from placement projectController (student_projects / placement routes).
 * All ownership checks use req.user.id (user_id).
 */

const pool = require('../config/db');

const VISIBILITY = ['PRIVATE', 'PUBLIC', 'LINK_ONLY'];

function sendError(res, status, message) {
  return res.status(status).json({ message: message || 'Error' });
}

/**
 * Resolve usn to user_id (user_login.id). Returns null if not found.
 */
async function resolveUsnToUserId(usn) {
  if (!usn || typeof usn !== 'string') return null;
  const u = (usn || '').trim().toUpperCase();
  if (!u) return null;
  const r = await pool.query('SELECT id FROM user_login WHERE usn = $1 LIMIT 1', [u]);
  return r.rows.length ? r.rows[0].id : null;
}

/**
 * Check student_edit_control.is_projects_locked for given usn. Returns true if locked (block edit/create).
 */
async function isProjectsLocked(usn) {
  if (!usn || typeof usn !== 'string') return false;
  const u = (usn || '').trim().toUpperCase();
  const r = await pool.query('SELECT is_projects_locked FROM student_edit_control WHERE usn = $1 LIMIT 1', [u]);
  return r.rows.length > 0 && r.rows[0].is_projects_locked === true;
}

/**
 * GET /api/projects
 * List projects: ?usn= for profile (admin/owner can pass usn), else list mine (req.user.id).
 * ?profile=1 or ?public_only=1: only non-private (visibility != 'PRIVATE'), order by priority DESC, published_at DESC (blueprint).
 */
exports.list = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?.user_id;
    const { usn, profile, public_only } = req.query;

    let ownerUserId = userId;
    if (usn && (req.user?.role === 'admin' || req.user?.role === 'vc' || (req.user?.usn && String(req.user.usn).toUpperCase() === String(usn).toUpperCase()))) {
      const resolved = await resolveUsnToUserId(usn);
      if (resolved != null) ownerUserId = resolved;
    }

    if (!ownerUserId) {
      return sendError(res, 401, 'Authentication required');
    }

    const forProfile = profile === '1' || profile === 'true' || public_only === '1' || public_only === 'true';
    const where = forProfile
      ? 'WHERE p.owner_user_id = $1 AND p.visibility != $2'
      : 'WHERE p.owner_user_id = $1';
    const orderBy = forProfile
      ? 'ORDER BY p.priority DESC, p.published_at DESC NULLS LAST, p.created_at DESC'
      : 'ORDER BY p.priority ASC, p.created_at DESC';
    const params = forProfile ? [ownerUserId, 'PRIVATE'] : [ownerUserId];

    const result = await pool.query(
      `SELECT p.*, m.views, m.likes, m.favorites, m.avg_rating, m.rating_count, m.comments
       FROM projects p
       LEFT JOIN project_metrics m ON m.project_id = p.id
       ${where}
       ${orderBy}`,
      params
    );

    res.json(result.rows || []);
  } catch (err) {
    console.error('projectsController.list:', err);
    sendError(res, 500, err.message || 'Server error');
  }
};

/**
 * Feed score formula (blueprint): balances freshness, popularity, and fairness.
 * score = (views*0.2) + (likes*1.5) + (favorites*2) + (avg_rating*3) - (age_in_days*0.1) + priority_boost + verified_boost
 */
const FEED_WEIGHTS = {
  views: 0.2,
  likes: 1.5,
  favorites: 2,
  avg_rating: 3,
  age_decay_per_day: 0.1,
  priority_boost_max: 5,   // priority 1 -> +5, 2 -> +4, ..., 5 -> +1
  verified_boost: 5,
};

/**
 * GET /api/projects/feed
 * Public feed: visibility = PUBLIC, published_at not null.
 * Ordered by discovery score (popular + fresh + fair), then priority, then newest.
 * Query: limit (default 20), sort=newest|score|popular
 * Returns each item with score and rank for display.
 */
exports.feed = async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const sort = (req.query.sort || 'score').toLowerCase();

    const baseWhere = `WHERE p.visibility IN ('PUBLIC', 'LINK_ONLY') AND p.published_at IS NOT NULL`;

    // Score expression matching blueprint: (views*0.2) + (likes*1.5) + (favorites*2) + (avg_rating*3) - age_days*0.1 + priority_boost + verified_boost
    const scoreExpr = `
      (COALESCE(m.views, 0) * ${FEED_WEIGHTS.views}
       + COALESCE(m.likes, 0) * ${FEED_WEIGHTS.likes}
       + COALESCE(m.favorites, 0) * ${FEED_WEIGHTS.favorites}
       + COALESCE(m.avg_rating, 0) * ${FEED_WEIGHTS.avg_rating}
       - EXTRACT(EPOCH FROM (NOW() - COALESCE(p.published_at, p.created_at))) / 86400.0 * ${FEED_WEIGHTS.age_decay_per_day}
       + (${FEED_WEIGHTS.priority_boost_max} + 1 - LEAST(COALESCE(p.priority, 5), 5))
       + CASE WHEN p.is_verified THEN ${FEED_WEIGHTS.verified_boost} ELSE 0 END
      )
    `;

    let orderBy;
    if (sort === 'newest') {
      orderBy = 'ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC';
    } else if (sort === 'popular') {
      orderBy = 'ORDER BY (COALESCE(m.views, 0) + COALESCE(m.likes, 0) * 2 + COALESCE(m.favorites, 0) * 2) DESC, p.published_at DESC';
    } else {
      // default: score (blueprint algorithm)
      orderBy = `ORDER BY score DESC, priority ASC, published_at DESC NULLS LAST`;
    }

    const query = sort === 'score'
      ? `
    WITH scored AS (
      SELECT
        p.id, p.owner_usn, p.owner_user_id, p.title, p.short_description, p.category, p.visibility,
        p.published_at, p.created_at, p.priority, p.is_verified,
        COALESCE(m.views, 0)::integer AS views,
        COALESCE(m.likes, 0)::integer AS likes,
        COALESCE(m.favorites, 0)::integer AS favorites,
        COALESCE(m.avg_rating, 0)::numeric AS avg_rating,
        COALESCE(m.rating_count, 0)::integer AS rating_count,
        (${scoreExpr}) AS score
      FROM projects p
      LEFT JOIN project_metrics m ON m.project_id = p.id
      ${baseWhere}
    )
    SELECT *, ROW_NUMBER() OVER (ORDER BY score DESC, priority ASC, published_at DESC NULLS LAST)::integer AS rank
    FROM scored
    ${orderBy}
    LIMIT $1
    `
      : `
    SELECT
      p.id, p.owner_usn, p.owner_user_id, p.title, p.short_description, p.category, p.visibility,
      p.published_at, p.created_at, p.priority, p.is_verified,
      COALESCE(m.views, 0)::integer AS views,
      COALESCE(m.likes, 0)::integer AS likes,
      COALESCE(m.favorites, 0)::integer AS favorites,
      COALESCE(m.avg_rating, 0)::numeric AS avg_rating,
      COALESCE(m.rating_count, 0)::integer AS rating_count,
      NULL::integer AS rank,
      (${scoreExpr}) AS score
    FROM projects p
    LEFT JOIN project_metrics m ON m.project_id = p.id
    ${baseWhere}
    ${orderBy}
    LIMIT $1
    `;

    const result = await pool.query(query, [limit]);

    let rows = result.rows || [];
    if (sort !== 'score' && rows.length) {
      rows = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    }

    res.json(rows);
  } catch (err) {
    console.error('projectsController.feed:', err);
    sendError(res, 500, err.message || 'Server error');
  }
};

/**
 * GET /api/projects/:id
 * Single project with assets, variants, and reviews. Enforce visibility.
 * For PUBLIC: register view (project_views + project_metrics.views) unless ?register_view=0.
 * Query: ?include_rank=true, ?register_view=0 to skip view registration.
 */
exports.getOne = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return sendError(res, 400, 'Invalid project id');
    const includeRank = req.query.include_rank === 'true' || req.query.include_rank === '1';
    const registerView = req.query.register_view !== '0';

    const proj = await pool.query(
      `SELECT p.*, m.views, m.likes, m.favorites, m.avg_rating, m.rating_count, m.comments
       FROM projects p
       LEFT JOIN project_metrics m ON m.project_id = p.id
       WHERE p.id = $1`,
      [id]
    );

    if (!proj.rows.length) return sendError(res, 404, 'Project not found');
    const project = proj.rows[0];

    // Visibility rules:
    // - PRIVATE: only owner (or admin/vc) via this endpoint
    // - PUBLIC / LINK_ONLY: world-visible
    if (project.visibility === 'PRIVATE') {
      const userId = req.user?.id ?? req.user?.user_id;
      const isOwner = userId && project.owner_user_id === userId;
      const isAdmin = req.user?.role === 'admin' || req.user?.role === 'vc';
      if (!isOwner && !isAdmin) {
        return sendError(res, 403, 'Access denied');
      }
    } else if (project.visibility !== 'PUBLIC') {
      return sendError(res, 403, 'Access denied');
    }

    // Register view for PUBLIC projects (blueprint: INSERT project_views, UPDATE project_metrics)
    if (project.visibility === 'PUBLIC' && registerView) {
      const userId = req.user?.id ?? req.user?.user_id ?? null;
      const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim() || null;
      await pool.query(
        'INSERT INTO project_views (project_id, user_id, ip_address) VALUES ($1, $2, $3)',
        [id, userId, ip || null]
      );
      await pool.query(
        'INSERT INTO project_metrics (project_id, views, likes, favorites, avg_rating, rating_count, comments) VALUES ($1, 1, 0, 0, 0, 0, 0) ON CONFLICT (project_id) DO UPDATE SET views = project_metrics.views + 1, last_updated = NOW()',
        [id]
      );
      const m = await pool.query('SELECT views, likes, favorites, avg_rating, rating_count, comments FROM project_metrics WHERE project_id = $1', [id]);
      if (m.rows.length) Object.assign(project, m.rows[0]);
    }

    // Load assets with variants (blueprint: project_assets ORDER BY position, then project_asset_variants)
    const assets = await pool.query(
      'SELECT * FROM project_assets WHERE project_id = $1 ORDER BY position ASC, id ASC',
      [id]
    );
    project.assets = assets.rows || [];
    const assetIds = project.assets.map((a) => a.id);
    if (assetIds.length > 0) {
      const variants = await pool.query(
        'SELECT * FROM project_asset_variants WHERE asset_id = ANY($1::bigint[]) ORDER BY asset_id, variant_type',
        [assetIds]
      );
      const variantsByAsset = {};
      (variants.rows || []).forEach((v) => {
        if (!variantsByAsset[v.asset_id]) variantsByAsset[v.asset_id] = [];
        variantsByAsset[v.asset_id].push(v);
      });
      project.assets = project.assets.map((a) => ({ ...a, variants: variantsByAsset[a.id] || [] }));
    }

    // Load reviews (blueprint: project_reviews with review + reply + likes)
    const reviews = await pool.query(
      `SELECT r.*, ul.email_id AS reviewer_email
       FROM project_reviews r
       LEFT JOIN user_login ul ON ul.id = r.reviewer_id
       WHERE r.project_id = $1
       ORDER BY r.review_created_at DESC`,
      [id]
    );
    project.reviews = reviews.rows || [];

    if (includeRank && project.visibility === 'PUBLIC') {
      const scoreExpr = `
        (COALESCE(m.views, 0) * ${FEED_WEIGHTS.views}
         + COALESCE(m.likes, 0) * ${FEED_WEIGHTS.likes}
         + COALESCE(m.favorites, 0) * ${FEED_WEIGHTS.favorites}
         + COALESCE(m.avg_rating, 0) * ${FEED_WEIGHTS.avg_rating}
         - EXTRACT(EPOCH FROM (NOW() - COALESCE(p.published_at, p.created_at))) / 86400.0 * ${FEED_WEIGHTS.age_decay_per_day}
         + (${FEED_WEIGHTS.priority_boost_max} + 1 - LEAST(COALESCE(p.priority, 5), 5))
         + CASE WHEN p.is_verified THEN ${FEED_WEIGHTS.verified_boost} ELSE 0 END
        )
      `;
      const rankResult = await pool.query(
        `WITH scored AS (
          SELECT p.id, (${scoreExpr}) AS score
          FROM projects p
          LEFT JOIN project_metrics m ON m.project_id = p.id
          WHERE p.visibility = 'PUBLIC' AND p.published_at IS NOT NULL
        ),
        with_rank AS (
          SELECT id, score, ROW_NUMBER() OVER (ORDER BY score DESC)::integer AS rank FROM scored
        )
        SELECT score, rank, (SELECT COUNT(*)::integer FROM scored) AS total_public
        FROM with_rank WHERE id = $1`,
        [id]
      );
      if (rankResult.rows.length) {
        project.score = parseFloat(rankResult.rows[0].score);
        project.rank = rankResult.rows[0].rank;
        project.total_public = rankResult.rows[0].total_public;
      }
    }

    res.json(project);
  } catch (err) {
    console.error('projectsController.getOne:', err);
    sendError(res, 500, err.message || 'Server error');
  }
};

/**
 * POST /api/projects
 * Create project as DRAFT: visibility = PRIVATE, published_at = NULL. Metrics created on Publish.
 * Permission: check student_edit_control.is_projects_locked for owner usn.
 */
exports.create = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) return sendError(res, 401, 'Authentication required');

    const usnRow = await pool.query('SELECT usn FROM user_login WHERE id = $1', [userId]);
    const ownerUsn = usnRow.rows.length && usnRow.rows[0].usn ? usnRow.rows[0].usn : null;
    if (!ownerUsn) return sendError(res, 403, 'Only students with USN can create projects');

    if (await isProjectsLocked(ownerUsn)) {
      return sendError(res, 403, 'Projects section is locked by administrator. You have view-only access.');
    }

    const body = req.body || {};
    const title = (body.title || '').toString().trim();
    if (!title) return sendError(res, 400, 'Title is required');
    const short_description = (body.short_description || '').toString().trim() || title.slice(0, 500);
    const description = (body.description || '').toString().trim() || null;
    const category = (body.category || '').toString().trim() || null;
    const tags = Array.isArray(body.tags) ? body.tags : (body.tags ? [body.tags] : []);
    const hosted_url = (body.hosted_url || body.hosted_link || '').toString().trim() || null;
    const github_url = (body.github_url || body.github_repo || '').toString().trim() || null;
    const mentor_name = (body.mentor_name || '').toString().trim() || null;
    const tech_stack = Array.isArray(body.tech_stack) ? body.tech_stack : (body.tech_stack ? [body.tech_stack] : []);
    const priority = parseInt(body.priority, 10);
    const priorityVal = Number.isInteger(priority) && priority >= 0 ? priority : 1;

    // Draft: always PRIVATE, published_at NULL. No project_metrics until Publish.
    const insert = await pool.query(
      `INSERT INTO projects (
        owner_usn, owner_user_id, title, short_description, description, category, tags,
        visibility, hosted_url, github_url, mentor_name, tech_stack, priority
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PRIVATE', $8, $9, $10, $11, $12)
      RETURNING *`,
      [ownerUsn, userId, title, short_description, description, category, tags, hosted_url, github_url, mentor_name, tech_stack, priorityVal]
    );

    res.status(201).json(insert.rows[0]);
  } catch (err) {
    console.error('projectsController.create:', err);
    sendError(res, 500, err.message || 'Server error');
  }
};

/**
 * PATCH /api/projects/:id/publish
 * Set visibility = PUBLIC, published_at = now(), ensure project_metrics row exists (blueprint Step 5).
 */
exports.publish = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return sendError(res, 400, 'Invalid project id');

    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) return sendError(res, 401, 'Authentication required');

    const existing = await pool.query('SELECT id, owner_user_id, owner_usn FROM projects WHERE id = $1', [id]);
    if (!existing.rows.length) return sendError(res, 404, 'Project not found');
    const project = existing.rows[0];
    if (project.owner_user_id !== userId && req.user?.role !== 'admin' && req.user?.role !== 'vc') {
      return sendError(res, 403, 'Access denied');
    }
    if (await isProjectsLocked(project.owner_usn)) {
      return sendError(res, 403, 'Projects section is locked by administrator.');
    }

    await pool.query(
      `UPDATE projects SET visibility = 'PUBLIC', published_at = COALESCE(published_at, NOW()), updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await pool.query(
      'INSERT INTO project_metrics (project_id, views, likes, favorites, avg_rating, rating_count, comments) VALUES ($1, 0, 0, 0, 0, 0, 0) ON CONFLICT (project_id) DO NOTHING',
      [id]
    );

    const updated = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    res.json(updated.rows[0]);
  } catch (err) {
    console.error('projectsController.publish:', err);
    sendError(res, 500, err.message || 'Server error');
  }
};

/**
 * PATCH /api/projects/:id
 * Update project. Owner only. Check is_projects_locked before allowing edit.
 */
exports.update = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return sendError(res, 400, 'Invalid project id');

    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) return sendError(res, 401, 'Authentication required');

    const existing = await pool.query('SELECT id, owner_user_id, owner_usn FROM projects WHERE id = $1', [id]);
    if (!existing.rows.length) return sendError(res, 404, 'Project not found');
    if (existing.rows[0].owner_user_id !== userId && req.user?.role !== 'admin' && req.user?.role !== 'vc') {
      return sendError(res, 403, 'Access denied');
    }
    if (await isProjectsLocked(existing.rows[0].owner_usn)) {
      return sendError(res, 403, 'Projects section is locked by administrator. You have view-only access.');
    }

    const body = req.body || {};
    const updates = [];
    const values = [];
    let idx = 1;

    const allowed = ['title', 'short_description', 'description', 'category', 'tags', 'visibility', 'hosted_url', 'github_url', 'mentor_name', 'tech_stack', 'priority'];
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      if (key === 'tags' || key === 'tech_stack') {
        updates.push(`${key} = $${idx}`);
        values.push(Array.isArray(body[key]) ? body[key] : []);
      } else if (key === 'visibility') {
        const v = (body[key] || '').toString().toUpperCase().trim();
        if (!VISIBILITY.includes(v)) continue;
        updates.push(`${key} = $${idx}`);
        values.push(v);
      } else if (key === 'priority') {
        const p = parseInt(body[key], 10);
        if (!Number.isInteger(p) || p < 0) continue;
        updates.push(`${key} = $${idx}`);
        values.push(p);
      } else {
        updates.push(`${key} = $${idx}`);
        values.push(typeof body[key] === 'string' ? body[key].trim() : body[key]);
      }
      idx++;
    }

    if (updates.length === 0) {
      const current = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
      return res.json(current.rows[0]);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);
    const result = await pool.query(
      `UPDATE projects SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('projectsController.update:', err);
    sendError(res, 500, err.message || 'Server error');
  }
};

/**
 * DELETE /api/projects/:id
 * Owner only (or admin). Cascades: assets, metrics, likes, etc. can be handled by DB or here.
 */
exports.delete = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return sendError(res, 400, 'Invalid project id');

    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) return sendError(res, 401, 'Authentication required');

    const existing = await pool.query('SELECT id, owner_user_id FROM projects WHERE id = $1', [id]);
    if (!existing.rows.length) return sendError(res, 404, 'Project not found');
    if (existing.rows[0].owner_user_id !== userId && req.user?.role !== 'admin' && req.user?.role !== 'vc') {
      return sendError(res, 403, 'Access denied');
    }

    await pool.query('DELETE FROM project_metrics WHERE project_id = $1', [id]);
    await pool.query('DELETE FROM project_views WHERE project_id = $1', [id]);
    await pool.query('DELETE FROM project_likes WHERE project_id = $1', [id]);
    await pool.query('DELETE FROM project_favorites WHERE project_id = $1', [id]);
    await pool.query('DELETE FROM project_ratings WHERE project_id = $1', [id]);
    await pool.query('DELETE FROM project_reviews WHERE project_id = $1', [id]);
    await pool.query('DELETE FROM project_share_links WHERE project_id = $1', [id]);
    const assets = await pool.query('SELECT id FROM project_assets WHERE project_id = $1', [id]);
    for (const a of assets.rows) {
      await pool.query('DELETE FROM project_asset_variants WHERE asset_id = $1', [a.id]);
    }
    await pool.query('DELETE FROM project_assets WHERE project_id = $1', [id]);
    await pool.query('DELETE FROM projects WHERE id = $1', [id]);

    res.status(204).send();
  } catch (err) {
    console.error('projectsController.delete:', err);
    sendError(res, 500, err.message || 'Server error');
  }
};

const ASSET_ROLES = ['LOGO', 'COVER', 'GALLERY', 'VIDEO'];
const ASSET_TYPES = ['IMAGE', 'VIDEO'];

/**
 * POST /api/projects/:id/assets
 * Add asset (original). Body: original_url, asset_type (IMAGE|VIDEO), asset_role (LOGO|COVER|GALLERY|VIDEO), position (optional).
 */
exports.addAsset = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) return sendError(res, 400, 'Invalid project id');

    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) return sendError(res, 401, 'Authentication required');

    const existing = await pool.query('SELECT id, owner_user_id, owner_usn FROM projects WHERE id = $1', [projectId]);
    if (!existing.rows.length) return sendError(res, 404, 'Project not found');
    if (existing.rows[0].owner_user_id !== userId && req.user?.role !== 'admin' && req.user?.role !== 'vc') {
      return sendError(res, 403, 'Access denied');
    }
    if (await isProjectsLocked(existing.rows[0].owner_usn)) {
      return sendError(res, 403, 'Projects section is locked.');
    }

    const body = req.body || {};
    const original_url = (body.original_url || body.url || '').toString().trim();
    if (!original_url) return sendError(res, 400, 'original_url is required');
    const asset_type = (body.asset_type || 'IMAGE').toString().toUpperCase();
    if (!ASSET_TYPES.includes(asset_type)) return sendError(res, 400, 'asset_type must be IMAGE or VIDEO');
    const asset_role = (body.asset_role || 'GALLERY').toString().toUpperCase();
    if (!ASSET_ROLES.includes(asset_role)) return sendError(res, 400, 'asset_role must be LOGO, COVER, GALLERY, or VIDEO');
    const position = parseInt(body.position, 10);
    const positionVal = Number.isInteger(position) && position >= 0 ? position : 0;
    const width = body.width != null ? parseInt(body.width, 10) : null;
    const height = body.height != null ? parseInt(body.height, 10) : null;
    const file_size_kb = body.file_size_kb != null ? parseInt(body.file_size_kb, 10) : null;
    const mime_type = (body.mime_type || '').toString().trim() || null;

    const ins = await pool.query(
      `INSERT INTO project_assets (project_id, asset_type, asset_role, original_url, width, height, file_size_kb, mime_type, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [projectId, asset_type, asset_role, original_url, width, height, file_size_kb, mime_type, positionVal]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    console.error('projectsController.addAsset:', err);
    sendError(res, 500, err.message || 'Server error');
  }
};

/**
 * DELETE /api/projects/:id/assets/:assetId
 */
exports.deleteAsset = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const assetId = parseInt(req.params.assetId, 10);
    if (Number.isNaN(projectId) || Number.isNaN(assetId)) return sendError(res, 400, 'Invalid id');

    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) return sendError(res, 401, 'Authentication required');

    const proj = await pool.query('SELECT id, owner_user_id, owner_usn FROM projects WHERE id = $1', [projectId]);
    if (!proj.rows.length) return sendError(res, 404, 'Project not found');
    if (proj.rows[0].owner_user_id !== userId && req.user?.role !== 'admin' && req.user?.role !== 'vc') {
      return sendError(res, 403, 'Access denied');
    }
    if (await isProjectsLocked(proj.rows[0].owner_usn)) return sendError(res, 403, 'Projects section is locked.');

    const asset = await pool.query('SELECT id FROM project_assets WHERE id = $1 AND project_id = $2', [assetId, projectId]);
    if (!asset.rows.length) return sendError(res, 404, 'Asset not found');

    await pool.query('DELETE FROM project_asset_variants WHERE asset_id = $1', [assetId]);
    await pool.query('DELETE FROM project_assets WHERE id = $1', [assetId]);
    res.status(204).send();
  } catch (err) {
    console.error('projectsController.deleteAsset:', err);
    sendError(res, 500, err.message || 'Server error');
  }
};

/**
 * POST /api/projects/:id/share
 * Create share link (LINK_ONLY). Body: expires_in_hours (optional). Returns share_token and url.
 */
exports.createShareLink = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) return sendError(res, 400, 'Invalid project id');

    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) return sendError(res, 401, 'Authentication required');

    const proj = await pool.query('SELECT id, owner_user_id, visibility FROM projects WHERE id = $1', [projectId]);
    if (!proj.rows.length) return sendError(res, 404, 'Project not found');
    const project = proj.rows[0];
    if (project.owner_user_id !== userId && req.user?.role !== 'admin' && req.user?.role !== 'vc') {
      return sendError(res, 403, 'Access denied');
    }

    // Only LINK_ONLY projects should use share links (not general PUBLIC feed items)
    if (project.visibility !== 'LINK_ONLY') {
      return sendError(res, 400, 'Share links can only be created for LINK_ONLY projects.');
    }

    const crypto = require('crypto');
    const share_token = crypto.randomBytes(16).toString('hex');
    const expires_in = parseInt(req.body?.expires_in_hours, 10);
    const expires_at = Number.isInteger(expires_in) && expires_in > 0
      ? new Date(Date.now() + expires_in * 60 * 60 * 1000)
      : null;

    await pool.query(
      'INSERT INTO project_share_links (project_id, share_token, expires_at) VALUES ($1, $2, $3)',
      [projectId, share_token, expires_at]
    );
    res.status(201).json({
      share_token,
      expires_at: expires_at ? expires_at.toISOString() : null,
      url: `/projects/share/${share_token}`,
    });
  } catch (err) {
    console.error('projectsController.createShareLink:', err);
    sendError(res, 500, err.message || 'Server error');
  }
};

/**
 * GET /api/projects/share/:token
 * Resolve share link (LINK_ONLY). Returns project with assets/variants/reviews (same shape as getOne).
 */
exports.resolveShare = async (req, res) => {
  try {
    const token = (req.params.token || '').toString().trim();
    if (!token) return sendError(res, 400, 'Invalid token');

    const link = await pool.query(
      `SELECT project_id FROM project_share_links
       WHERE share_token = $1 AND is_active = true
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [token]
    );
    if (!link.rows.length) return sendError(res, 404, 'Invalid or expired share link');

    const projectId = link.rows[0].project_id;
    const proj = await pool.query(
      `SELECT p.*, m.views, m.likes, m.favorites, m.avg_rating, m.rating_count, m.comments
       FROM projects p LEFT JOIN project_metrics m ON m.project_id = p.id WHERE p.id = $1`,
      [projectId]
    );
    if (!proj.rows.length) return sendError(res, 404, 'Project not found');
    const project = proj.rows[0];

    const assets = await pool.query('SELECT * FROM project_assets WHERE project_id = $1 ORDER BY position ASC, id ASC', [projectId]);
    project.assets = assets.rows || [];
    const assetIds = project.assets.map((a) => a.id);
    if (assetIds.length > 0) {
      const variants = await pool.query('SELECT * FROM project_asset_variants WHERE asset_id = ANY($1::bigint[]) ORDER BY asset_id, variant_type', [assetIds]);
      const byAsset = {};
      (variants.rows || []).forEach((v) => {
        if (!byAsset[v.asset_id]) byAsset[v.asset_id] = [];
        byAsset[v.asset_id].push(v);
      });
      project.assets = project.assets.map((a) => ({ ...a, variants: byAsset[a.id] || [] }));
    }
    const reviews = await pool.query(
      `SELECT r.*, ul.email_id AS reviewer_email FROM project_reviews r LEFT JOIN user_login ul ON ul.id = r.reviewer_id WHERE r.project_id = $1 ORDER BY r.review_created_at DESC`,
      [projectId]
    );
    project.reviews = reviews.rows || [];

    res.json(project);
  } catch (err) {
    console.error('projectsController.resolveShare:', err);
    sendError(res, 500, err.message || 'Server error');
  }
};

/**
 * POST /api/projects/:id/reviews
 * Add review. Body: review_text. Auth required.
 */
exports.addReview = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) return sendError(res, 400, 'Invalid project id');

    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) return sendError(res, 401, 'Authentication required');

    const proj = await pool.query('SELECT id, owner_user_id FROM projects WHERE id = $1', [projectId]);
    if (!proj.rows.length) return sendError(res, 404, 'Project not found');
    const project = proj.rows[0];
    if (project.visibility !== 'PUBLIC') return sendError(res, 403, 'Project is not public');

    const review_text = (req.body?.review_text || '').toString().trim();
    if (!review_text) return sendError(res, 400, 'review_text is required');

    await pool.query(
      'INSERT INTO project_reviews (project_id, reviewer_id, owner_id, review_text) VALUES ($1, $2, $3, $4)',
      [projectId, userId, project.owner_user_id, review_text]
    );
    await pool.query(
      'INSERT INTO project_metrics (project_id, views, likes, favorites, avg_rating, rating_count, comments) VALUES ($1, 0, 0, 0, 0, 0, 1) ON CONFLICT (project_id) DO UPDATE SET comments = project_metrics.comments + 1, last_updated = NOW()',
      [projectId]
    );

    const list = await pool.query(
      `SELECT r.*, ul.email_id AS reviewer_email FROM project_reviews r LEFT JOIN user_login ul ON ul.id = r.reviewer_id WHERE r.project_id = $1 ORDER BY r.review_created_at DESC`,
      [projectId]
    );
    res.status(201).json(list.rows[0] || {});
  } catch (err) {
    console.error('projectsController.addReview:', err);
    sendError(res, 500, err.message || 'Server error');
  }
};
