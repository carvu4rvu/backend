const { pool, queryOne, queryMany } = require('../db/query');
const storageService = require('../services/storageService');
const { notifyVcUsersForCampusEvents } = require('../utils/notificationHelper');

function normalizeImages(images) {
  if (Array.isArray(images)) return images;
  if (images && typeof images === 'object') return Object.values(images).filter(Boolean);
  return [];
}

function withEventImageUrl(ev) {
  const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  return {
    ...ev,
    images: normalizeImages(ev.images),
    image_url:
      baseUrl && ev.id
        ? `${baseUrl}/storage/v1/object/public/system-assets/events/${ev.id}.jpg`
        : null,
  };
}

/**
 * List events. Optional ?status=scheduled|ongoing|completed|failed
 */
exports.list = async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM events';
    const params = [];
    if (status && ['scheduled', 'ongoing', 'completed', 'failed'].includes(status)) {
      sql += ' WHERE status = $1';
      params.push(status);
    }
    sql += ' ORDER BY event_datetime ASC';
    const rows = await queryMany(sql, params);
    res.json(rows.map(withEventImageUrl));
  } catch (err) {
    console.error('Events list error:', err);
    res.status(500).json({ message: err.message || 'Failed to list events' });
  }
};

/**
 * GET /events/notification-stats
 * Returns eventId -> { notificationId, sent, read } for events that have linked notifications.
 */
exports.getNotificationStats = async (req, res) => {
  try {
    const notifications = await queryMany(
      'SELECT id, link FROM notifications WHERE is_active = true'
    );
    const stats = {};
    for (const n of notifications || []) {
      const m = (n.link || '').match(/event[s]?[\/\-](\d+)/i) || (n.link || '').match(/\?.*event[=_]?(\d+)/i);
      if (m) {
        const eventId = m[1];
        stats[eventId] = { notificationId: n.id, sent: 0, read: 0 };
      }
    }
    const nodes = await queryMany('SELECT notification_id, is_read FROM notification_nodes');
    for (const node of nodes || []) {
      const n = (notifications || []).find((x) => x.id === node.notification_id);
      if (n) {
        const m = (n.link || '').match(/event[s]?[\/\-](\d+)/i) || (n.link || '').match(/\?.*event[=_]?(\d+)/i);
        if (m && stats[m[1]]) {
          stats[m[1]].sent = (stats[m[1]].sent || 0) + 1;
          if (node.is_read) stats[m[1]].read = (stats[m[1]].read || 0) + 1;
        }
      }
    }
    res.json(stats);
  } catch (err) {
    console.error('Events getNotificationStats error:', err);
    res.json({});
  }
};

/**
 * Get single event by id
 */
exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await queryOne('SELECT * FROM events WHERE id = $1', [id]);
    if (!data) return res.status(404).json({ message: 'Event not found' });
    res.json(withEventImageUrl(data));
  } catch (err) {
    console.error('Events getById error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch event' });
  }
};

/**
 * Create event (admin)
 */
exports.create = async (req, res) => {
  try {
    const { title, type, details, event_datetime, images, attachments, status } = req.body;
    if (!title || !type) {
      return res.status(400).json({ message: 'Title and type are required' });
    }
    const payload = {
      title,
      type,
      details: details || null,
      event_datetime: event_datetime || null,
      images: images || [],
      attachments: attachments || [],
      status: status || 'scheduled',
    };
    const keys = Object.keys(payload);
    const placeholders = keys.map((_, i) => `$${i + 1}`);
    const { rows } = await pool.query(
      `INSERT INTO events (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      keys.map((k) => payload[k])
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Events create error:', err);
    res.status(500).json({ message: err.message || 'Failed to create event' });
  }
};

/**
 * Update event (admin)
 */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, type, details, event_datetime, images, attachments, status } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (type !== undefined) updates.type = type;
    if (details !== undefined) updates.details = details;
    if (event_datetime !== undefined) updates.event_datetime = event_datetime;
    if (images !== undefined) updates.images = images;
    if (attachments !== undefined) updates.attachments = attachments;
    if (status !== undefined) updates.status = status;
    updates.updated_at = new Date().toISOString();

    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await pool.query(
      `UPDATE events SET ${setClause} WHERE id = $1 RETURNING *`,
      [id, ...keys.map((k) => updates[k])]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Event not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Events update error:', err);
    res.status(500).json({ message: err.message || 'Failed to update event' });
  }
};

/**
 * POST /events/:id/image — upload cover image to system-assets/events/{id}.jpg
 */
exports.uploadImage = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: 'No file uploaded. Use multipart field name "file".' });
    }
    const event = await queryOne('SELECT id FROM events WHERE id = $1', [id]);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const { url, path: storagePath, bucket } = await storageService.uploadEventImage(file.buffer, id);

    await pool.query(
      `UPDATE events SET images = $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [id, JSON.stringify([url])]
    );

    res.json({
      message: 'Event image uploaded',
      url,
      path: storagePath,
      bucket,
      image_url: url,
    });
  } catch (err) {
    console.error('Events uploadImage error:', err);
    const msg = err.userMessage || err.message || 'Failed to upload event image';
    res.status(500).json({ message: msg });
  }
};

/**
 * POST /events/notify-vc-digest
 * Admin: one EVENT notification per campus event, each delivered to all VC users.
 */
exports.notifyVcDigest = async (req, res) => {
  try {
    const events = await queryMany('SELECT * FROM events ORDER BY event_datetime ASC NULLS LAST');
    if (!events.length) {
      return res.status(400).json({ message: 'No events to notify about' });
    }

    const createdBy = req.user?.id || null;
    const result = await notifyVcUsersForCampusEvents(events, createdBy);

    if (!result.vcCount) {
      return res.status(400).json({ message: 'No active VC users found' });
    }
    if (!result.notificationsCreated) {
      return res.status(500).json({ message: 'Failed to create VC notifications' });
    }

    res.json({
      message: 'Notifications sent to VC',
      notificationIds: result.notificationIds,
      notificationsCreated: result.notificationsCreated,
      vcCount: result.vcCount,
      eventCount: result.eventCount,
    });
  } catch (err) {
    console.error('Events notifyVcDigest error:', err);
    res.status(500).json({ message: err.message || 'Failed to notify VC' });
  }
};

/**
 * POST /events/:id/notify-vc
 * Admin: one EVENT notification for a single campus event to all VC users.
 */
exports.notifyVcForEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await queryOne('SELECT * FROM events WHERE id = $1', [id]);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const createdBy = req.user?.id || null;
    const result = await notifyVcUsersForCampusEvents([event], createdBy);

    if (!result.vcCount) {
      return res.status(400).json({ message: 'No active VC users found' });
    }
    if (!result.notificationsCreated) {
      return res.status(500).json({ message: 'Failed to create VC notification' });
    }

    res.json({
      message: 'Notification sent to VC',
      notificationId: result.notificationIds[0] ?? null,
      vcCount: result.vcCount,
      eventCount: 1,
    });
  } catch (err) {
    console.error('Events notifyVcForEvent error:', err);
    res.status(500).json({ message: err.message || 'Failed to notify VC' });
  }
};

/**
 * Delete event (admin)
 */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM events WHERE id = $1', [id]);
    res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('Events delete error:', err);
    res.status(500).json({ message: err.message || 'Failed to delete event' });
  }
};
