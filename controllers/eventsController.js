const supabase = require('../config/supabaseClient');

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
 * GET /events/notification-stats
 * Returns eventId -> { notificationId, sent, read } for events that have linked notifications.
 */
exports.getNotificationStats = async (req, res) => {
  try {
    const { data: notifications } = await supabase
      .from('notifications')
      .select('id, link')
      .eq('is_active', true);
    const stats = {};
    for (const n of notifications || []) {
      const m = (n.link || '').match(/event[s]?[\/\-](\d+)/i) || (n.link || '').match(/\?.*event[=_]?(\d+)/i);
      if (m) {
        const eventId = m[1];
        stats[eventId] = { notificationId: n.id, sent: 0, read: 0 };
      }
    }
    const { data: nodes } = await supabase
      .from('notification_nodes')
      .select('notification_id, is_read');
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
