const pool = require('../config/db');

const TARGET_CUSTOM = 'CUSTOM';
const NOTIFICATION_TYPE_PLACEMENT = 'PLACEMENT';

/**
 * Resolve USNs to user_login ids (active users only).
 * @param {string[]} usns
 * @returns {Promise<number[]>}
 */
async function getUserIdsByUsns(usns) {
  if (!Array.isArray(usns) || usns.length === 0) return [];
  const result = await pool.query(
    'SELECT id FROM user_login WHERE usn = ANY($1::text[]) AND is_active = true',
    [usns]
  );
  return (result.rows || []).map((r) => r.id);
}

/**
 * Resolve user_ids to { user_id, user_role, recipient_entity_id } for notification_nodes.
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
    if (r.usn) entity_id = r.usn;
    else if (r.company_id != null) entity_id = String(r.company_id);
    else if (r.role && r.role.toLowerCase() === 'alumni' && r.email_id) {
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
 * Create a notification and send it to the given user_ids (insert notification_nodes).
 * @param {object} opts - { title, message, link?, notification_type?, created_by? }
 * @param {number[]} user_ids
 * @returns {Promise<{ notificationId: number | null, sent: number }>}
 */
async function createAndSendToUserIds(opts, user_ids) {
  if (!opts || !opts.title || !opts.message) return { notificationId: null, sent: 0 };
  if (!Array.isArray(user_ids) || user_ids.length === 0) return { notificationId: null, sent: 0 };

  const notifType = (opts.notification_type && typeof opts.notification_type === 'string')
    ? opts.notification_type.trim().toUpperCase()
    : NOTIFICATION_TYPE_PLACEMENT;
  const link = opts.link && typeof opts.link === 'string' ? opts.link.trim() : null;
  const created_by = opts.created_by != null ? opts.created_by : null;

  const insertResult = await pool.query(
    `INSERT INTO notifications (
      title, message, link, visible_from, visible_until,
      target_type, target_role, created_by, is_active, notification_type
    ) VALUES ($1, $2, $3, NULL, NULL, $4, NULL, $5, true, $6)
    RETURNING id`,
    [opts.title.trim(), opts.message.trim(), link, TARGET_CUSTOM, created_by, notifType]
  );
  const notificationId = insertResult.rows[0]?.id;
  if (!notificationId) return { notificationId: null, sent: 0 };

  const recipientRows = await resolveRecipientEntityIds(user_ids);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  for (const row of recipientRows) {
    await pool.query(
      `INSERT INTO notification_nodes (notification_id, user_id, user_role, recipient_entity_id, delivered, created_at)
       VALUES ($1, $2, $3, $4, true, $5::timestamp)`,
      [notificationId, row.user_id, row.user_role, row.recipient_entity_id, now]
    );
  }
  return { notificationId, sent: recipientRows.length };
}

/**
 * Create a placement notification and send to students by USN.
 * Link should be full URL (e.g. FRONTEND_URL + /student/placements/drive/:driveId).
 * @param {object} opts - { title, message, link?, created_by? }
 * @param {string[]} usns - student USNs
 * @returns {Promise<{ notificationId: number | null, sent: number }>}
 */
async function createAndSendToUsns(opts, usns) {
  if (!Array.isArray(usns) || usns.length === 0) return { notificationId: null, sent: 0 };
  const user_ids = await getUserIdsByUsns(usns);
  if (user_ids.length === 0) return { notificationId: null, sent: 0 };
  const payload = {
    ...opts,
    notification_type: opts.notification_type || NOTIFICATION_TYPE_PLACEMENT,
  };
  return createAndSendToUserIds(payload, user_ids);
}

module.exports = {
  createAndSendToUsns,
  createAndSendToUserIds,
  getUserIdsByUsns,
};
