const pool = require('../config/db');

/**
 * GET /api/student/notifications
 * List notification_nodes for the authenticated student (user_id).
 * Query: tab (unread|read|archived|starred), search, page, limit.
 */
exports.list = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { tab = 'unread', search, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(100, Math.max(1, parseInt(limit, 10)));
    const limitVal = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const searchTerm = typeof search === 'string' && search.trim() ? search.trim() : null;

    const conditions = ['nn.user_id = $1', 'n.is_active = true'];
    const params = [userId];
    let idx = 2;

    if (tab === 'unread') {
      conditions.push('nn.is_read = false');
      conditions.push('(nn.is_archived = false OR nn.is_archived IS NULL)');
    } else if (tab === 'read') {
      conditions.push('nn.is_read = true');
      conditions.push('(nn.is_archived = false OR nn.is_archived IS NULL)');
    } else if (tab === 'archived') {
      conditions.push('nn.is_archived = true');
    } else if (tab === 'starred') {
      conditions.push('nn.is_starred = true');
    }

    if (searchTerm) {
      conditions.push(`(n.title ILIKE $${idx} OR n.message ILIKE $${idx})`);
      params.push(`%${searchTerm}%`);
      idx++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM notification_nodes nn
      INNER JOIN notifications n ON n.id = nn.notification_id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const total = countResult.rows[0]?.total ?? 0;

    params.push(limitVal, offset);
    const listQuery = `
      SELECT nn.id AS node_id, nn.notification_id, nn.is_read, nn.read_at, nn.is_archived, nn.is_starred, nn.created_at AS node_created_at,
             n.title, n.message, n.link, n.notification_type, n.created_at AS notification_created_at
      FROM notification_nodes nn
      INNER JOIN notifications n ON n.id = nn.notification_id
      ${whereClause}
      ORDER BY nn.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    const listResult = await pool.query(listQuery, params);

    const notifications = (listResult.rows || []).map((r) => ({
      id: r.node_id,
      notificationId: r.notification_id,
      title: r.title,
      message: r.message,
      link: r.link,
      notificationType: r.notification_type,
      isRead: r.is_read,
      readAt: r.read_at,
      isArchived: r.is_archived,
      isStarred: r.is_starred,
      createdAt: r.node_created_at || r.notification_created_at,
    }));

    res.json({
      notifications,
      total,
      page: parseInt(page, 10) || 1,
      limit: limitVal,
      totalPages: Math.ceil(total / limitVal) || 1,
    });
  } catch (err) {
    console.error('studentNotificationController.list:', err);
    res.status(500).json({ message: 'Failed to list notifications' });
  }
};

/**
 * GET /api/student/notifications/unread-count
 * Get unread count for badge.
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) {
      return res.json({ unreadCount: 0 });
    }

    const result = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM notification_nodes nn
       INNER JOIN notifications n ON n.id = nn.notification_id
       WHERE nn.user_id = $1 AND n.is_active = true AND nn.is_read = false
         AND (nn.is_archived = false OR nn.is_archived IS NULL)`,
      [userId]
    );
    const unreadCount = result.rows[0]?.c ?? 0;
    res.json({ unreadCount });
  } catch (err) {
    console.error('studentNotificationController.getUnreadCount:', err);
    res.json({ unreadCount: 0 });
  }
};

/**
 * PATCH /api/student/notifications/:nodeId
 * Update a notification node: is_read, is_archived, is_starred.
 * Body: { is_read?, is_archived?, is_starred? }
 */
exports.updateNode = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const nodeId = parseInt(req.params.nodeId, 10);
    if (!Number.isFinite(nodeId)) {
      return res.status(400).json({ message: 'Invalid node id' });
    }

    const { is_read, is_archived, is_starred } = req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (typeof is_read === 'boolean') {
      updates.push(`is_read = $${idx}`, `read_at = $${idx + 1}`);
      values.push(is_read, is_read ? new Date() : null);
      idx += 2;
    }
    if (typeof is_archived === 'boolean') {
      updates.push(`is_archived = $${idx}`, `archived_at = $${idx + 1}`);
      values.push(is_archived, is_archived ? new Date() : null);
      idx += 2;
    }
    if (typeof is_starred === 'boolean') {
      updates.push(`is_starred = $${idx}`, `starred_at = $${idx + 1}`);
      values.push(is_starred, is_starred ? new Date() : null);
      idx += 2;
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No updates provided' });
    }

    values.push(nodeId, userId);
    const result = await pool.query(
      `UPDATE notification_nodes
       SET ${updates.join(', ')}
       WHERE id = $${idx} AND user_id = $${idx + 1}
       RETURNING id, is_read, is_archived, is_starred`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found or access denied' });
    }

    res.json({ node: result.rows[0] });
  } catch (err) {
    console.error('studentNotificationController.updateNode:', err);
    res.status(500).json({ message: 'Failed to update notification' });
  }
};
