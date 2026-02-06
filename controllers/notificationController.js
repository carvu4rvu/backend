const supabase = require('../config/supabaseClient');
const pool = require('../config/db');

const NOTIFICATION_TYPES = ['SYSTEM', 'ACADEMIC', 'PLACEMENT', 'ALERT', 'GENERAL'];

/**
 * Build stats map: notification_id -> { sent, unread, read }
 */
async function getStatsMap(notificationIds = []) {
  if (!notificationIds.length) return {};
  const placeholders = notificationIds.map((_, i) => `$${i + 1}`).join(',');
  const q = `
    SELECT notification_id, is_read, COUNT(*) AS c
    FROM student_notifications
    WHERE notification_id IN (${placeholders})
    GROUP BY notification_id, is_read
  `;
  const { rows } = await pool.query(q, notificationIds);
  const map = {};
  notificationIds.forEach((id) => {
    map[id] = { sent: 0, unread: 0, read: 0 };
  });
  rows.forEach((r) => {
    if (!map[r.notification_id]) map[r.notification_id] = { sent: 0, unread: 0, read: 0 };
    map[r.notification_id].sent += parseInt(r.c, 10);
    if (r.is_read) map[r.notification_id].read += parseInt(r.c, 10);
    else map[r.notification_id].unread += parseInt(r.c, 10);
  });
  return map;
}

/**
 * POST /api/notifications
 * Create notification only (no send). Body: { title, message, type, link? }
 */
exports.create = async (req, res) => {
  try {
    const { title, message, type, link, event_id, drive_id } = req.body;
    if (!title || !message || !type) {
      return res.status(400).json({ message: 'Title, message, and type are required' });
    }
    if (!NOTIFICATION_TYPES.includes(type)) {
      return res.status(400).json({
        message: `Type must be one of: ${NOTIFICATION_TYPES.join(', ')}`,
      });
    }

    const createdBy = req.user?.id != null ? String(req.user.id) : null;
    const eventId = event_id != null ? parseInt(event_id, 10) : null;
    const driveId = drive_id != null ? parseInt(drive_id, 10) : null;

    const insertPayload = {
      title: String(title).trim(),
      message: String(message).trim(),
      type,
      link: link && String(link).trim() ? String(link).trim() : null,
      created_by: createdBy,
    };
    if (eventId && !Number.isNaN(eventId)) {
      insertPayload.event_id = eventId;
    }
    if (driveId && !Number.isNaN(driveId)) {
      insertPayload.drive_id = driveId;
    }

    const { data: notification, error } = await supabase
      .from('notifications')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.error('Create notification error:', error);
      return res.status(500).json({ message: 'Failed to create notification' });
    }

    return res.status(201).json(notification);
  } catch (err) {
    console.error('create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/notifications/:id/send
 * Send notification to selected students. Body: { usns: string[] }
 */
exports.send = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { usns = [] } = req.body;
    if (Number.isNaN(id) || !Array.isArray(usns)) {
      return res.status(400).json({ message: 'Invalid notification id or usns' });
    }

    const { data: notif, error: fetchErr } = await supabase
      .from('notifications')
      .select('id')
      .eq('id', id)
      .single();

    if (fetchErr || !notif) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const uniqueUsns = [...new Set(usns)].filter(Boolean);
    if (uniqueUsns.length === 0) {
      return res.status(400).json({ message: 'Select at least one student' });
    }

    const { data: existing } = await supabase
      .from('student_notifications')
      .select('usn')
      .eq('notification_id', id)
      .in('usn', uniqueUsns);

    const alreadySent = new Set((existing || []).map((r) => r.usn));
    const toInsert = uniqueUsns.filter((u) => !alreadySent.has(u)).map((usn) => ({
      usn,
      notification_id: id,
      is_read: false,
    }));

    if (toInsert.length === 0) {
      return res.json({ ok: true, recipientsCount: 0, message: 'All selected students already received this notification' });
    }

    const { error: insertErr } = await supabase.from('student_notifications').insert(toInsert);
    if (insertErr) {
      console.error('Send notification error:', insertErr);
      return res.status(500).json({ message: 'Failed to send to some students' });
    }

    return res.json({ ok: true, recipientsCount: toInsert.length });
  } catch (err) {
    console.error('send error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/notifications
 * List all notifications (admin) with stats: sent, unread, read.
 */
exports.list = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const { data: rows, error, count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const ids = (rows || []).map((r) => r.id);
    const statsMap = await getStatsMap(ids);

    const notifications = (rows || []).map((r) => ({
      ...r,
      sent: (statsMap[r.id] && statsMap[r.id].sent) || 0,
      unread: (statsMap[r.id] && statsMap[r.id].unread) || 0,
      read: (statsMap[r.id] && statsMap[r.id].read) || 0,
    }));

    const total = count != null ? count : notifications.length;
    return res.json({
      notifications,
      total,
      page,
      limit,
      totalPages: Math.ceil((total || 0) / limit),
    });
  } catch (err) {
    console.error('list notifications error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/notifications/:id/recipients
 * List all recipients for a notification with read/unread status and student details (admin).
 */
exports.getRecipients = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'Invalid id' });

    const { data: notification, error: notifErr } = await supabase
      .from('notifications')
      .select('id')
      .eq('id', id)
      .single();

    if (notifErr || !notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const { rows } = await pool.query(
      `SELECT 
        sn.id AS student_notification_id,
        sn.usn,
        sn.is_read,
        sn.delivered_at,
        sn.read_at,
        s.full_name,
        s.college_email,
        s.year_of_joining,
        ul.is_active AS login_is_active,
        sch.name AS school_name,
        sch.abbreviation AS school_abbreviation,
        p.name AS program_name
      FROM student_notifications sn
      LEFT JOIN student_basic_details s ON s.usn = sn.usn
      LEFT JOIN user_login ul ON ul.usn = s.usn
      LEFT JOIN schools sch ON sch.id = s.school_id
      LEFT JOIN programs p ON p.id = s.program_id
      WHERE sn.notification_id = $1
      ORDER BY sn.is_read ASC, sn.delivered_at DESC`,
      [id]
    );

    const recipients = (rows || []).map((r) => ({
      studentNotificationId: r.student_notification_id,
      usn: r.usn,
      fullName: r.full_name,
      collegeEmail: r.college_email,
      schoolName: r.school_name || r.school_abbreviation || '—',
      programName: r.program_name || '—',
      yearOfJoining: r.year_of_joining,
      isActive: r.login_is_active !== false,
      isRead: !!r.is_read,
      deliveredAt: r.delivered_at,
      readAt: r.read_at,
    }));

    const read = recipients.filter((r) => r.isRead);
    const unread = recipients.filter((r) => !r.isRead);

    return res.json({
      recipients,
      read,
      unread,
      total: recipients.length,
      readCount: read.length,
      unreadCount: unread.length,
    });
  } catch (err) {
    console.error('getRecipients error:', err);
    return res.status(500).json({ message: 'Failed to fetch recipients' });
  }
};

/**
 * POST /api/notifications/:id/resend
 * Resend notification to selected students (admin). Body: { usns: string[] }
 * - For students who already received: bump delivered_at and reset is_read so it shows as new.
 * - For students who haven't received: insert new record (same as send).
 */
exports.resend = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { usns = [] } = req.body;
    if (Number.isNaN(id) || !Array.isArray(usns)) {
      return res.status(400).json({ message: 'Invalid notification id or usns' });
    }

    const { data: notif, error: fetchErr } = await supabase
      .from('notifications')
      .select('id')
      .eq('id', id)
      .single();

    if (fetchErr || !notif) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const uniqueUsns = [...new Set(usns)].filter(Boolean);
    if (uniqueUsns.length === 0) {
      return res.status(400).json({ message: 'Select at least one recipient to resend' });
    }

    const { data: existing } = await supabase
      .from('student_notifications')
      .select('id, usn')
      .eq('notification_id', id)
      .in('usn', uniqueUsns);

    const existingByUsn = new Map((existing || []).map((r) => [r.usn, r.id]));
    const toInsert = uniqueUsns.filter((u) => !existingByUsn.has(u));
    const toBump = uniqueUsns.filter((u) => existingByUsn.has(u));

    let insertedCount = 0;
    if (toInsert.length > 0) {
      const rows = toInsert.map((usn) => ({
        usn,
        notification_id: id,
        is_read: false,
      }));
      const { error: insertErr } = await supabase.from('student_notifications').insert(rows);
      if (insertErr) {
        console.error('Resend insert error:', insertErr);
        return res.status(500).json({ message: 'Failed to send to some students' });
      }
      insertedCount = toInsert.length;
    }

    let bumpedCount = 0;
    if (toBump.length > 0) {
      const idsToBump = toBump.map((u) => existingByUsn.get(u));
      const { error: updateErr } = await supabase
        .from('student_notifications')
        .update({ delivered_at: new Date().toISOString(), is_read: false })
        .in('id', idsToBump);
      if (updateErr) {
        console.error('Resend bump error:', updateErr);
        return res.status(500).json({ message: 'Failed to resend to some recipients' });
      }
      bumpedCount = toBump.length;
    }

    return res.json({
      ok: true,
      recipientsCount: insertedCount + bumpedCount,
      insertedCount,
      bumpedCount,
      message: `Resent to ${insertedCount + bumpedCount} recipient(s)${insertedCount > 0 ? ` (${insertedCount} new)` : ''}${bumpedCount > 0 ? ` (${bumpedCount} reminder)` : ''}`,
    });
  } catch (err) {
    console.error('resend error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/notifications/:id
 * Single notification with stats (admin).
 */
exports.getById = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'Invalid id' });

    const { data: notification, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const statsMap = await getStatsMap([id]);
    const stats = statsMap[id] || { sent: 0, unread: 0, read: 0 };

    return res.json({
      ...notification,
      sent: stats.sent,
      unread: stats.unread,
      read: stats.read,
    });
  } catch (err) {
    console.error('getById error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/notifications/me
 * Student's notifications.
 */
exports.getMyNotifications = async (req, res) => {
  try {
    const usn = req.user?.usn;
    if (!usn) {
      return res.status(403).json({ message: 'Student USN required' });
    }

    const { data: rows, error } = await supabase
      .from('student_notifications')
      .select(
        `
        id,
        notification_id,
        is_read,
        delivered_at,
        read_at,
        is_starred,
        is_archived,
        starred_at,
        archived_at,
        notification:notifications (
          id,
          title,
          message,
          type,
          link,
          created_at,
          event_id,
          drive_id
        )
      `
      )
      .eq('usn', usn)
      .order('delivered_at', { ascending: false });

    if (error) throw error;

    const list = (rows || []).map((r) => {
      const n = r.notification || {};
      return {
        id: r.id,
        notificationId: r.notification_id,
        isRead: !!r.is_read,
        deliveredAt: r.delivered_at,
        readAt: r.read_at,
        isStarred: !!r.is_starred,
        isArchived: !!r.is_archived,
        starredAt: r.starred_at,
        archivedAt: r.archived_at,
        title: n.title,
        message: n.message,
        type: n.type,
        link: n.link,
        created_at: n.created_at,
        event_id: n.event_id,
        drive_id: n.drive_id,
      };
    });

    return res.json(list);
  } catch (err) {
    console.error('getMyNotifications error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const usn = req.user?.usn;
    const id = parseInt(req.params.id, 10);
    if (!usn || Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    const { data: row, error: fetchErr } = await supabase
      .from('student_notifications')
      .select('id, usn')
      .eq('id', id)
      .single();

    if (fetchErr || !row) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    if (row.usn !== usn) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { error: updateErr } = await supabase
      .from('student_notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id);

    if (updateErr) throw updateErr;
    return res.json({ ok: true });
  } catch (err) {
    console.error('markAsRead error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    const usn = req.user?.usn;
    if (!usn) {
      return res.status(403).json({ message: 'Student USN required' });
    }

    const { error } = await supabase
      .from('student_notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('usn', usn)
      .eq('is_read', false);

    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error('markAllAsRead error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PATCH /api/notifications/me/:id/star
 * Toggle starred for a student notification.
 */
exports.toggleStar = async (req, res) => {
  try {
    const usn = req.user?.usn;
    const id = parseInt(req.params.id, 10);
    if (!usn || Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    const { data: row, error: fetchErr } = await supabase
      .from('student_notifications')
      .select('id, usn, is_starred')
      .eq('id', id)
      .single();

    if (fetchErr || !row) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    if (row.usn !== usn) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const newStarred = !row.is_starred;
    const { error: updateErr } = await supabase
      .from('student_notifications')
      .update({
        is_starred: newStarred,
        starred_at: newStarred ? new Date().toISOString() : null,
      })
      .eq('id', id);

    if (updateErr) throw updateErr;
    return res.json({ ok: true, isStarred: newStarred });
  } catch (err) {
    console.error('toggleStar error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PATCH /api/notifications/me/:id/archive
 * Toggle archived for a student notification.
 */
exports.toggleArchive = async (req, res) => {
  try {
    const usn = req.user?.usn;
    const id = parseInt(req.params.id, 10);
    if (!usn || Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    const { data: row, error: fetchErr } = await supabase
      .from('student_notifications')
      .select('id, usn, is_archived')
      .eq('id', id)
      .single();

    if (fetchErr || !row) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    if (row.usn !== usn) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const newArchived = !row.is_archived;
    const { error: updateErr } = await supabase
      .from('student_notifications')
      .update({
        is_archived: newArchived,
        archived_at: newArchived ? new Date().toISOString() : null,
      })
      .eq('id', id);

    if (updateErr) throw updateErr;
    return res.json({ ok: true, isArchived: newArchived });
  } catch (err) {
    console.error('toggleArchive error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/notifications/me/unread-count
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const usn = req.user?.usn;
    if (!usn) {
      return res.status(403).json({ message: 'Student USN required' });
    }

    const { count, error } = await supabase
      .from('student_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('usn', usn)
      .eq('is_read', false);

    if (error) throw error;
    return res.json({ count: count ?? 0 });
  } catch (err) {
    console.error('getUnreadCount error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
