const pool = require('../config/db');

const NOTIFICATION_TYPE_CUSTOM = 'CUSTOM';
const TARGET_ALL = 'ALL';
const TARGET_ROLE = 'ROLE';
const TARGET_CUSTOM = 'CUSTOM';

/**
 * GET /api/notifications
 * List notifications with optional filters: notification_type, search (universal: title, message, type), page, limit.
 */
exports.list = async (req, res) => {
  try {
    const { notification_type, search, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(100, Math.max(1, parseInt(limit, 10)));
    const limitVal = Math.min(100, Math.max(1, parseInt(limit, 10)));

    const conditions = ['n.is_active = true'];
    const params = [];
    let idx = 1;
    if (notification_type !== undefined && notification_type !== '' && notification_type !== 'all') {
      conditions.push(`n.notification_type = $${idx}`);
      params.push(String(notification_type).trim().toUpperCase());
      idx++;
    }
    const searchTerm = typeof search === 'string' && search.trim() ? search.trim() : null;
    if (searchTerm) {
      conditions.push(`(
        n.title ILIKE $${idx} OR
        n.message ILIKE $${idx} OR
        n.notification_type ILIKE $${idx}
      )`);
      params.push(`%${searchTerm}%`);
      idx++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // One row per unique title + message + type (merged broadcast)
    const countQuery = `
      SELECT COUNT(*)::int AS total FROM (
        SELECT 1
        FROM notifications n
        ${whereClause}
        GROUP BY n.title, n.message, n.notification_type
      ) merged
    `;
    const countResult = await pool.query(countQuery, params);
    const total = countResult.rows[0]?.total ?? 0;

    params.push(limitVal, offset);
    const listQuery = `
      WITH filtered AS (
        SELECT n.id, n.title, n.message, n.link,
               n.visible_from, n.visible_until, n.target_type, n.target_role, n.created_by, n.reason,
               n.created_at, n.notification_type
        FROM notifications n
        ${whereClause}
      ),
      with_counts AS (
        SELECT f.*,
          (SELECT COUNT(*)::int FROM notification_nodes nn WHERE nn.notification_id = f.id) AS recipient_count,
          (SELECT COUNT(*)::int FROM notification_nodes nn WHERE nn.notification_id = f.id AND COALESCE(nn.delivered, false) = true) AS delivered_count,
          (SELECT COUNT(*)::int FROM notification_nodes nn WHERE nn.notification_id = f.id AND COALESCE(nn.is_read, false) = true) AS read_count
        FROM filtered f
      )
      SELECT
        MIN(w.created_at) AS created_at,
        w.title,
        w.message,
        w.notification_type,
        MIN(w.id) AS id,
        ARRAY_AGG(w.id ORDER BY w.created_at ASC) AS notification_ids,
        COALESCE(SUM(w.recipient_count), 0)::int AS recipient_count,
        COALESCE(SUM(w.delivered_count), 0)::int AS delivered_count,
        COALESCE(SUM(w.read_count), 0)::int AS read_count,
        COUNT(*)::int AS merge_count
      FROM with_counts w
      GROUP BY w.title, w.message, w.notification_type
      ORDER BY MIN(w.created_at) DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    const listResult = await pool.query(listQuery, params);

    res.json({
      notifications: listResult.rows,
      total,
      page: parseInt(page, 10) || 1,
      limit: limitVal,
      totalPages: Math.ceil(total / limitVal) || 1,
    });
  } catch (err) {
    console.error('notificationController.list:', err);
    res.status(500).json({ message: 'Failed to list notifications' });
  }
};

/**
 * GET /api/notifications/roles
 * List roles for dropdown (admin notifications).
 */
exports.getRoles = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM roles ORDER BY name');
    res.json({ roles: result.rows });
  } catch (err) {
    console.error('notificationController.getRoles:', err);
    res.status(500).json({ message: 'Failed to fetch roles' });
  }
};

/**
 * GET /api/notifications/recipient-options
 * List users for notification targeting. Query: type=students|alumni|companies|roles, search, school_id, program_id, limit.
 * Returns options with id (user_login.id for users, or role id/name for type=roles) and label for display.
 */
exports.getRecipientOptions = async (req, res) => {
  try {
    const type = (req.query.type || '').trim().toLowerCase();
    const search = (req.query.search || '').trim();
    const schoolId = req.query.school_id ? parseInt(req.query.school_id, 10) : null;
    const programId = req.query.program_id ? parseInt(req.query.program_id, 10) : null;
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));

    if (type === 'roles') {
      const result = await pool.query('SELECT id, name FROM roles ORDER BY name');
      const options = (result.rows || []).map((r) => ({
        id: r.id,
        name: r.name,
        label: r.name,
        type: 'role',
      }));
      return res.json({ options });
    }

    if (type === 'students') {
      let query = `
        SELECT ul.id, ul.usn, s.full_name, ul.email_id AS email
        FROM user_login ul
        INNER JOIN student_basic_details s ON s.usn = ul.usn
        WHERE ul.is_active = true AND ul.usn IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM alumni a WHERE a.student_id = ul.usn)
      `;
      const params = [];
      let idx = 1;
      if (schoolId != null && !Number.isNaN(schoolId)) {
        params.push(schoolId);
        query += ` AND s.school_id = $${idx}`;
        idx++;
      }
      if (programId != null && !Number.isNaN(programId)) {
        params.push(programId);
        query += ` AND s.program_id = $${idx}`;
        idx++;
      }
      if (search) {
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        query += ` AND (s.usn ILIKE $${idx} OR s.full_name ILIKE $${idx + 1} OR ul.email_id ILIKE $${idx + 2})`;
        idx += 3;
      }
      params.push(limit);
      query += ` ORDER BY s.full_name LIMIT $${idx}`;
      const result = await pool.query(query, params);
      const options = (result.rows || []).map((r) => ({
        id: r.id,
        entity_id: r.usn,
        usn: r.usn,
        full_name: r.full_name,
        email: r.email,
        label: `${r.full_name || r.usn} (${r.usn})`,
        type: 'student',
      }));
      return res.json({ options });
    }

    if (type === 'alumni') {
      let query = `
        SELECT ul.id, a.id AS alumni_id, a.full_name, ul.email_id AS email
        FROM user_login ul
        INNER JOIN roles r ON r.id = ul.role_id
        LEFT JOIN alumni a ON a.personal_email = ul.email_id
        WHERE ul.is_active = true AND LOWER(r.name) = 'alumni'
      `;
      const params = [];
      let idx = 1;
      if (search) {
        params.push(`%${search}%`, `%${search}%`);
        query += ` AND (COALESCE(a.full_name, ul.email_id, '') ILIKE $${idx} OR ul.email_id ILIKE $${idx + 1})`;
        idx += 2;
      }
      params.push(limit);
      query += ` ORDER BY COALESCE(a.full_name, ul.email_id) LIMIT $${idx}`;
      const result = await pool.query(query, params);
      const options = (result.rows || []).map((r) => ({
        id: r.id,
        entity_id: r.alumni_id != null ? r.alumni_id : null,
        full_name: r.full_name,
        email: r.email,
        label: r.full_name ? `${r.full_name} (${r.email})` : (r.email || String(r.id)),
        type: 'alumni',
      }));
      return res.json({ options });
    }

    if (type === 'companies') {
      let query = `
        SELECT ul.id, c.id AS company_id, c.company_name, ul.email_id AS email
        FROM user_login ul
        INNER JOIN companies c ON c.id = ul.company_id
        WHERE ul.company_id IS NOT NULL AND ul.is_active = true
      `;
      const params = [];
      let idx = 1;
      if (search) {
        params.push(`%${search}%`, `%${search}%`);
        query += ` AND (c.company_name ILIKE $${idx} OR ul.email_id ILIKE $${idx + 1})`;
        idx += 2;
      }
      params.push(limit);
      query += ` ORDER BY c.company_name LIMIT $${idx}`;
      const result = await pool.query(query, params);
      const options = (result.rows || []).map((r) => ({
        id: r.id,
        entity_id: r.company_id != null ? r.company_id : null,
        company_name: r.company_name,
        email: r.email,
        label: `${r.company_name} (${r.email || ''})`.trim(),
        type: 'company',
      }));
      return res.json({ options });
    }

    if (type === 'role_users') {
      const roleName = (req.query.role || '').trim();
      if (!roleName) {
        return res.status(400).json({ message: 'role query is required for type=role_users' });
      }
      const result = await pool.query(
        `SELECT ul.id, ul.email_id AS email
         FROM user_login ul
         INNER JOIN roles r ON r.id = ul.role_id
         WHERE ul.is_active = true AND LOWER(r.name) = LOWER($1)
         ORDER BY ul.email_id
         LIMIT $2`,
        [roleName, limit]
      );
      const options = (result.rows || []).map((r) => ({
        id: r.id,
        email: r.email,
        label: r.email || String(r.id),
        type: 'role_user',
      }));
      return res.json({ options });
    }

    return res.status(400).json({ message: 'Invalid type. Use students, alumni, companies, roles, or role_users' });
  } catch (err) {
    console.error('notificationController.getRecipientOptions:', err);
    res.status(500).json({ message: 'Failed to fetch recipient options' });
  }
};

/**
 * POST /api/notifications
 * Create a custom notification (no recipients yet). Body: title, message, notification_type?, link?, visible_from?, visible_until?
 */
exports.create = async (req, res) => {
  try {
    const {
      title,
      message,
      notification_type = NOTIFICATION_TYPE_CUSTOM,
      link = null,
      visible_from = null,
      visible_until = null,
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({ message: 'Title and message are required' });
    }

    const created_by = req.user?.id || null;
    const notifType = (notification_type && typeof notification_type === 'string')
      ? notification_type.trim().toUpperCase()
      : NOTIFICATION_TYPE_CUSTOM;

    const insertResult = await pool.query(
      `INSERT INTO notifications (
        title, message, link, visible_from, visible_until,
        target_type, target_role, created_by, is_active, notification_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
      RETURNING id, title, message, link, visible_from, visible_until, target_type, target_role, created_by, created_at, notification_type`,
      [
        title.trim(),
        message.trim(),
        link && typeof link === 'string' ? link.trim() : null,
        visible_from || null,
        visible_until || null,
        TARGET_CUSTOM,
        null,
        created_by,
        notifType,
      ]
    );

    res.status(201).json(insertResult.rows[0]);
  } catch (err) {
    console.error('notificationController.create:', err);
    res.status(500).json({ message: 'Failed to create notification' });
  }
};

/**
 * GET /api/notifications/:id
 * Get single notification with recipient count and stats.
 */
exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT n.id, n.title, n.message, n.link,
              n.visible_from, n.visible_until, n.target_type, n.target_role, n.created_by, n.reason, n.created_at, n.notification_type,
              (SELECT COUNT(*)::int FROM notification_nodes nn WHERE nn.notification_id = n.id) AS recipient_count,
              (SELECT COUNT(*)::int FROM notification_nodes nn WHERE nn.notification_id = n.id AND nn.is_read = true) AS read_count
       FROM notifications n
       WHERE n.id = $1 AND n.is_active = true`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('notificationController.getById:', err);
    res.status(500).json({ message: 'Failed to fetch notification' });
  }
};

/**
 * PATCH /api/notifications/:id
 * Update notification (title, message, notification_type, link, visible_from, visible_until).
 */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      message,
      notification_type,
      link,
      visible_from,
      visible_until,
    } = req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) {
      updates.push(`title = $${idx}`);
      values.push(typeof title === 'string' ? title.trim() : title);
      idx++;
    }
    if (message !== undefined) {
      updates.push(`message = $${idx}`);
      values.push(typeof message === 'string' ? message.trim() : message);
      idx++;
    }
    if (notification_type !== undefined) {
      updates.push(`notification_type = $${idx}`);
      values.push(typeof notification_type === 'string' ? notification_type.trim().toUpperCase() : NOTIFICATION_TYPE_CUSTOM);
      idx++;
    }
    if (link !== undefined) {
      updates.push(`link = $${idx}`);
      values.push(link && typeof link === 'string' ? link.trim() : null);
      idx++;
    }
    if (visible_from !== undefined) {
      updates.push(`visible_from = $${idx}`);
      values.push(visible_from || null);
      idx++;
    }
    if (visible_until !== undefined) {
      updates.push(`visible_until = $${idx}`);
      values.push(visible_until || null);
      idx++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(id);
    const updateResult = await pool.query(
      `UPDATE notifications SET ${updates.join(', ')} WHERE id = $${idx} AND is_active = true RETURNING id, title, message, link, visible_from, visible_until, target_type, target_role, created_at, notification_type`,
      values
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json(updateResult.rows[0]);
  } catch (err) {
    console.error('notificationController.update:', err);
    res.status(500).json({ message: 'Failed to update notification' });
  }
};

/**
 * DELETE /api/notifications/:id
 * Soft-delete: set is_active = false.
 */
exports.delete = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE notifications SET is_active = false WHERE id = $1 AND is_active = true RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.status(200).json({ message: 'Notification deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('notificationController.delete:', err);
    res.status(500).json({ message: 'Failed to delete notification' });
  }
};

/**
 * Resolve user_login ids from target_type, target_roles (role names), or user_ids.
 */
async function resolveRecipientUserIds(target_type, target_roles, user_ids) {
  if (target_type === TARGET_CUSTOM && Array.isArray(user_ids) && user_ids.length > 0) {
    const result = await pool.query(
      'SELECT id FROM user_login WHERE id = ANY($1::bigint[]) AND is_active = true',
      [user_ids]
    );
    return result.rows.map((r) => r.id);
  }

  if (target_type === TARGET_ROLE && Array.isArray(target_roles) && target_roles.length > 0) {
    const names = target_roles.map((r) => (r && typeof r === 'string' ? r.trim().toLowerCase() : '')).filter(Boolean);
    if (names.length === 0) return [];
    const result = await pool.query(
      `SELECT ul.id FROM user_login ul JOIN roles r ON r.id = ul.role_id WHERE lower(r.name) = ANY($1::text[]) AND ul.is_active = true`,
      [names]
    );
    return result.rows.map((r) => r.id);
  }

  if (target_type === TARGET_ALL) {
    const result = await pool.query('SELECT id FROM user_login WHERE is_active = true');
    return result.rows.map((r) => r.id);
  }

  return [];
}

/**
 * Resolve user_ids to { user_id, user_role, recipient_entity_id }.
 * recipient_entity_id: USN (students), alumni.id (alumni), company id (companies), null for role-only users.
 */
async function resolveRecipientEntityIds(user_ids) {
  if (!Array.isArray(user_ids) || user_ids.length === 0) return [];
  const result = await pool.query(
    `SELECT ul.id, ul.usn, ul.company_id, ul.email_id, r.name AS role
     FROM user_login ul
     JOIN roles r ON r.id = ul.role_id
     WHERE ul.id = ANY($1::bigint[])`,
    [user_ids]
  );
  const rows = result.rows || [];
  const alumniEmails = rows.filter((r) => r.role && r.role.toLowerCase() === 'alumni').map((r) => r.email_id).filter(Boolean);
  let alumniByEmail = new Map();
  if (alumniEmails.length > 0) {
    const alumniRes = await pool.query(
      'SELECT id, personal_email FROM alumni WHERE personal_email = ANY($1::text[])',
      [alumniEmails]
    );
    (alumniRes.rows || []).forEach((a) => alumniByEmail.set(a.personal_email, a.id));
  }
  return rows.map((r) => {
    let entity_id = null;
    if (r.usn) {
      entity_id = r.usn;
    } else if (r.company_id != null) {
      entity_id = String(r.company_id);
    } else if (r.role && r.role.toLowerCase() === 'alumni' && r.email_id) {
      const aid = alumniByEmail.get(r.email_id);
      if (aid != null) entity_id = String(aid);
    }
    return {
      user_id: r.id,
      user_role: r.role || null,
      recipient_entity_id: entity_id,
    };
  });
}

/**
 * POST /api/notifications/:id/send
 * Create notification_nodes for selected recipients. Body: target_type ('ALL'|'ROLE'|'CUSTOM'), target_roles?: string[], user_ids?: number[]
 */
exports.send = async (req, res) => {
  try {
    const { id } = req.params;
    const { target_type = TARGET_CUSTOM, target_roles, user_ids } = req.body;

    const notifResult = await pool.query(
      'SELECT id, target_type, target_role FROM notifications WHERE id = $1 AND is_active = true',
      [id]
    );
    if (notifResult.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const recipientIds = await resolveRecipientUserIds(
      target_type,
      target_roles || [],
      user_ids || []
    );

    if (recipientIds.length === 0) {
      return res.status(400).json({ message: 'No recipients resolved. Check target_type, target_roles, or user_ids.' });
    }

    const targetRoleStr =
      target_type === TARGET_ROLE && Array.isArray(target_roles) && target_roles.length > 0
        ? target_roles.map((r) => (r && typeof r === 'string' ? r.trim() : '')).filter(Boolean).join(',')
        : null;

    await pool.query(
      `UPDATE notifications SET target_type = $1, target_role = $2 WHERE id = $3`,
      [target_type, targetRoleStr, id]
    );

    const recipientRows = await resolveRecipientEntityIds(recipientIds);

    const existing = await pool.query(
      'SELECT user_id, recipient_entity_id FROM notification_nodes WHERE notification_id = $1',
      [id]
    );
    const existingKeys = new Set(
      (existing.rows || []).map((r) =>
        r.recipient_entity_id != null ? `e:${r.recipient_entity_id}` : `u:${r.user_id}`
      )
    );
    const toInsert = recipientRows.filter(
      (r) => !existingKeys.has(r.recipient_entity_id != null ? `e:${r.recipient_entity_id}` : `u:${r.user_id}`)
    );
    let inserted = 0;
    if (toInsert.length > 0) {
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
      for (const row of toInsert) {
        await pool.query(
          `INSERT INTO notification_nodes (notification_id, user_id, user_role, recipient_entity_id, delivered, created_at)
           VALUES ($1, $2, $3, $4, true, $5::timestamp)`,
          [id, row.user_id, row.user_role, row.recipient_entity_id, now]
        );
        inserted++;
      }
    }

    const totalNodes = await pool.query(
      'SELECT COUNT(*)::int AS c FROM notification_nodes WHERE notification_id = $1',
      [id]
    );

    res.json({
      message: 'Notification sent',
      inserted,
      total_recipients: totalNodes.rows[0].c,
    });
  } catch (err) {
    console.error('notificationController.send:', err);
    res.status(500).json({ message: 'Failed to send notification' });
  }
};

/**
 * GET /api/notifications/:id/recipients
 * List notification_nodes (recipients) for this notification.
 */
exports.getRecipients = async (req, res) => {
  try {
    const { id } = req.params;
    const notifCheck = await pool.query('SELECT id FROM notifications WHERE id = $1 AND is_active = true', [id]);
    if (notifCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const result = await pool.query(
      `SELECT nn.id, nn.user_id, nn.user_role, nn.recipient_entity_id, nn.delivered, nn.delivered_at, nn.is_read, nn.read_at, nn.is_archived, nn.starred_at, nn.created_at,
              ul.usn, ul.email_id, ul.company_id
       FROM notification_nodes nn
       LEFT JOIN user_login ul ON ul.id = nn.user_id
       WHERE nn.notification_id = $1
       ORDER BY nn.created_at DESC`,
      [id]
    );
    const rows = result.rows || [];
    const studentUsns = [];
    const alumniIds = [];
    const companyIds = [];
    for (const r of rows) {
      if (r.recipient_entity_id == null) continue;
      const role = (r.user_role || '').toLowerCase();
      if (role === 'student' || (r.usn != null && r.recipient_entity_id === r.usn)) studentUsns.push(r.recipient_entity_id);
      else if (role === 'alumni') alumniIds.push(r.recipient_entity_id);
      else if (role === 'company' || r.company_id != null) companyIds.push(r.recipient_entity_id);
    }
    const studentLabels = new Map();
    const alumniLabels = new Map();
    const companyLabels = new Map();
    if (studentUsns.length > 0) {
      const s = await pool.query('SELECT full_name, usn FROM student_basic_details WHERE usn = ANY($1::text[])', [studentUsns]);
      (s.rows || []).forEach((x) => studentLabels.set(x.usn, `${x.full_name} (${x.usn})`));
    }
    const alumniIdsNum = alumniIds.filter((id) => id != null && !Number.isNaN(Number(id))).map(Number);
    if (alumniIdsNum.length > 0) {
      const a = await pool.query('SELECT id, full_name, personal_email FROM alumni WHERE id = ANY($1::bigint[])', [alumniIdsNum]);
      (a.rows || []).forEach((x) => alumniLabels.set(String(x.id), `${x.full_name} (${x.personal_email || ''})`.trim()));
    }
    const companyIdsNum = companyIds.filter((id) => id != null && !Number.isNaN(Number(id))).map(Number);
    if (companyIdsNum.length > 0) {
      const c = await pool.query('SELECT id, company_name FROM companies WHERE id = ANY($1::bigint[])', [companyIdsNum]);
      (c.rows || []).forEach((x) => companyLabels.set(String(x.id), x.company_name));
    }
    for (const r of rows) {
      const role = (r.user_role || '').toLowerCase();
      if (r.recipient_entity_id != null) {
        if (role === 'student' || (r.usn != null && r.recipient_entity_id === r.usn)) r.display_label = studentLabels.get(r.recipient_entity_id);
        else if (role === 'alumni') r.display_label = alumniLabels.get(r.recipient_entity_id);
        else if (role === 'company' || r.company_id != null) r.display_label = companyLabels.get(r.recipient_entity_id);
      }
      if (!r.display_label) r.display_label = r.usn ? `${r.usn} (${r.email_id || ''})` : (r.email_id || `User ${r.user_id}`);
    }

    res.json({ recipients: rows });
  } catch (err) {
    console.error('notificationController.getRecipients:', err);
    res.status(500).json({ message: 'Failed to fetch recipients' });
  }
};

/**
 * POST /api/notifications/:id/resend
 * Create additional notification_nodes for given user_ids (or same target again). Body: user_ids?: number[] or target_type, target_roles
 */
exports.resend = async (req, res) => {
  try {
    const { id } = req.params;
    const { user_ids, target_type, target_roles } = req.body;

    const notifResult = await pool.query(
      'SELECT id FROM notifications WHERE id = $1 AND is_active = true',
      [id]
    );
    if (notifResult.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    let recipientIds = [];
    if (Array.isArray(user_ids) && user_ids.length > 0) {
      const r = await pool.query(
        'SELECT id FROM user_login WHERE id = ANY($1::bigint[]) AND is_active = true',
        [user_ids]
      );
      recipientIds = r.rows.map((row) => row.id);
    } else if (target_type === TARGET_ALL) {
      recipientIds = await resolveRecipientUserIds(TARGET_ALL, [], []);
    } else if (target_type === TARGET_ROLE && Array.isArray(target_roles) && target_roles.length > 0) {
      recipientIds = await resolveRecipientUserIds(TARGET_ROLE, target_roles, []);
    } else {
      return res.status(400).json({ message: 'Provide user_ids, target_type: "ALL", or target_type with target_roles' });
    }

    if (recipientIds.length === 0) {
      return res.status(400).json({ message: 'No recipients to resend to' });
    }

    const recipientRows = await resolveRecipientEntityIds(recipientIds);
    const existing = await pool.query(
      'SELECT user_id, recipient_entity_id FROM notification_nodes WHERE notification_id = $1',
      [id]
    );
    const existingKeys = new Set(
      (existing.rows || []).map((r) =>
        r.recipient_entity_id != null ? `e:${r.recipient_entity_id}` : `u:${r.user_id}`
      )
    );
    const toInsert = recipientRows.filter(
      (r) => !existingKeys.has(r.recipient_entity_id != null ? `e:${r.recipient_entity_id}` : `u:${r.user_id}`)
    );

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    for (const row of toInsert) {
      await pool.query(
        `INSERT INTO notification_nodes (notification_id, user_id, user_role, recipient_entity_id, delivered, created_at)
         VALUES ($1, $2, $3, $4, true, $5::timestamp)`,
        [id, row.user_id, row.user_role, row.recipient_entity_id, now]
      );
    }

    const totalNodes = await pool.query(
      'SELECT COUNT(*)::int AS c FROM notification_nodes WHERE notification_id = $1',
      [id]
    );

    res.json({
      message: 'Resend complete',
      inserted: toInsert.length,
      total_recipients: totalNodes.rows[0].c,
    });
  } catch (err) {
    console.error('notificationController.resend:', err);
    res.status(500).json({ message: 'Failed to resend notification' });
  }
};

/**
 * POST /api/notifications/:id/duplicate
 * Duplicate notification (same content), return new notification. No nodes copied.
 */
exports.duplicate = async (req, res) => {
  try {
    const { id } = req.params;
    const created_by = req.user?.id || null;

    const row = await pool.query(
      `SELECT title, message, link, visible_from, visible_until, notification_type
       FROM notifications WHERE id = $1 AND is_active = true`,
      [id]
    );
    if (row.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const n = row.rows[0];
    const insertResult = await pool.query(
      `INSERT INTO notifications (
        title, message, link, visible_from, visible_until,
        target_type, target_role, created_by, is_active, notification_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
      RETURNING id, title, message, link, created_at`,
      [
        n.title,
        n.message,
        n.link,
        n.visible_from,
        n.visible_until,
        null,
        null,
        created_by,
        n.notification_type || NOTIFICATION_TYPE_CUSTOM,
      ]
    );

    res.status(201).json(insertResult.rows[0]);
  } catch (err) {
    console.error('notificationController.duplicate:', err);
    res.status(500).json({ message: 'Failed to duplicate notification' });
  }
};
