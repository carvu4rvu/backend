const supabase = require('../config/supabaseClient');
const pool = require('../config/db');

/**
 * GET /api/events/notification-stats
 * Returns event_id -> { read, sent, notificationId } for notifications linked to events
 */
exports.getNotificationStats = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT n.event_id, n.id AS notification_id,
        COUNT(sn.id) AS sent,
        COALESCE(SUM(CASE WHEN sn.is_read = true THEN 1 ELSE 0 END), 0) AS read_count
      FROM notifications n
      LEFT JOIN student_notifications sn ON sn.notification_id = n.id
      WHERE n.event_id IS NOT NULL
      GROUP BY n.event_id, n.id, n.created_at
      ORDER BY n.created_at DESC
    `);
    const byEvent = {};
    (rows || []).forEach((r) => {
      const eventId = r.event_id;
      if (!byEvent[eventId]) {
        byEvent[eventId] = {
          read: parseInt(r.read_count, 10) || 0,
          sent: parseInt(r.sent, 10) || 0,
          notificationId: r.notification_id,
        };
      }
    });
    res.json(byEvent);
  } catch (err) {
    console.error('Events notification stats error:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch notification stats' });
  }
};

/**
 * List events. Optional ?status=scheduled|ongoing|completed|failed
 */
exports.list = async (req, res) => {
  try {
    let query = supabase
      .from('events')
      .select('*')
      .order('event_datetime', { ascending: true });

    const { status } = req.query;
    if (status && ['scheduled', 'ongoing', 'completed', 'failed'].includes(status)) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Events list error:', err);
    res.status(500).json({ message: err.message || 'Failed to list events' });
  }
};

/**
 * Get single event by id
 */
exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ message: 'Event not found' });
      throw error;
    }
    res.json(data);
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
    const { data, error } = await supabase
      .from('events')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
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

    const { data, error } = await supabase
      .from('events')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Events update error:', err);
    res.status(500).json({ message: err.message || 'Failed to update event' });
  }
};

/**
 * Delete event (admin)
 */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (error) throw error;
    res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('Events delete error:', err);
    res.status(500).json({ message: err.message || 'Failed to delete event' });
  }
};
