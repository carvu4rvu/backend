/**
 * Semester unlock requests: students request unlock, admin approves/rejects.
 * Approving directly unlocks the semester in student_edit_control.
 * Notifications sent on approve (automated) and reject (optional, with remarks).
 */

const pool = require('../config/db');
const { sendValidationError, sendCaughtError } = require('../utils/apiErrorResponse');
const { createAndSendToUsns } = require('../utils/notificationHelper');

/**
 * GET /placement/students/sem-unlock-requests (admin)
 * List all semester unlock requests, optionally filtered by status.
 */
exports.list = async (req, res) => {
  const client = await pool.connect();
  try {
    const status = (req.query.status || '').toString().toLowerCase();
    const validStatus = status && ['pending', 'approved', 'rejected'].includes(status);
    const query = validStatus
      ? `SELECT r.id, r.usn, r.semester, r.reason, r.status, r.created_at,
                r.reviewed_by, r.reviewed_at, r.admin_notes,
                s.full_name AS student_name, s.college_email AS student_email,
                COALESCE(ap.full_name, ul.email_id::text) AS reviewed_by_name
         FROM public.semester_unlock_requests r
         JOIN public.student_basic_details s ON s.usn = r.usn
         LEFT JOIN public.user_login ul ON ul.id = r.reviewed_by
         LEFT JOIN public.admin_profiles ap ON ap.user_login_id = ul.id
         WHERE r.status = $1
         ORDER BY r.created_at DESC`
      : `SELECT r.id, r.usn, r.semester, r.reason, r.status, r.created_at,
                r.reviewed_by, r.reviewed_at, r.admin_notes,
                s.full_name AS student_name, s.college_email AS student_email,
                COALESCE(ap.full_name, ul.email_id::text) AS reviewed_by_name
         FROM public.semester_unlock_requests r
         JOIN public.student_basic_details s ON s.usn = r.usn
         LEFT JOIN public.user_login ul ON ul.id = r.reviewed_by
         LEFT JOIN public.admin_profiles ap ON ap.user_login_id = ul.id
         ORDER BY r.created_at DESC`;
    const { rows } = await client.query(query, validStatus ? [status] : undefined);
    return res.json({ rows: rows || [] });
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to fetch semester unlock requests.');
  } finally {
    client.release();
  }
};

/**
 * GET /placement/students/sem-unlock-requests/me (student)
 * Returns the authenticated student's own pending unlock requests (semester numbers).
 */
exports.getMyPending = async (req, res) => {
  const client = await pool.connect();
  try {
    const usn = (req.user?.usn || '').toString().trim().toUpperCase();
    if (!usn) return res.status(401).json({ message: 'Unauthorized.' });

    const { rows } = await client.query(
      `SELECT semester FROM public.semester_unlock_requests WHERE usn = $1 AND status = 'pending'`,
      [usn]
    );
    const semesters = (rows || []).map((r) => Number(r.semester)).filter((s) => s >= 1 && s <= 8);
    return res.json({ semesters });
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to fetch your unlock requests.');
  } finally {
    client.release();
  }
};

/**
 * POST /placement/students/sem-unlock-requests (student)
 * Create a new unlock request. Student must own the USN.
 */
exports.create = async (req, res) => {
  const client = await pool.connect();
  try {
    const usn = (req.user?.usn || '').toString().trim().toUpperCase();
    if (!usn) return res.status(401).json({ message: 'Unauthorized.' });

    const { semester, reason } = req.body || {};
    const semNum = Number(semester);
    if (!semNum || semNum < 1 || semNum > 8) {
      return sendValidationError(res, 'Semester must be between 1 and 8.');
    }
    const reasonStr = (reason || '').toString().trim();
    if (!reasonStr) return sendValidationError(res, 'Reason is required.');

    // Check for existing pending request
    const { rows: existing } = await client.query(
      `SELECT id FROM public.semester_unlock_requests WHERE usn = $1 AND semester = $2 AND status = 'pending'`,
      [usn, semNum]
    );
    if (existing?.length) {
      return res.status(400).json({
        message: `You already have a pending request for Semester ${semNum}.`,
      });
    }

    const { rows } = await client.query(
      `INSERT INTO public.semester_unlock_requests (usn, semester, reason)
       VALUES ($1, $2, $3)
       RETURNING id, usn, semester, reason, status, created_at`,
      [usn, semNum, reasonStr]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to create unlock request.');
  } finally {
    client.release();
  }
};

/**
 * PUT /placement/students/sem-unlock-requests/:id/approve (admin)
 * Approve request and unlock the semester.
 */
exports.approve = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) return sendValidationError(res, 'Invalid request ID.');

    const adminId = req.user?.id ?? null;

    const { rows } = await client.query(
      `SELECT id, usn, semester, status FROM public.semester_unlock_requests WHERE id = $1`,
      [id]
    );
    if (!rows?.length) return res.status(404).json({ message: 'Request not found.' });
    const reqRow = rows[0];
    if (reqRow.status !== 'pending') {
      return res.status(400).json({ message: `Request already ${reqRow.status}.` });
    }

    const field = `is_sem${reqRow.semester}_locked`;

    await client.query('BEGIN');

    await client.query(
      `UPDATE public.semester_unlock_requests
       SET status = 'approved', reviewed_by = $2, reviewed_at = now()
       WHERE id = $1`,
      [id, adminId]
    );

    await client.query(
      `INSERT INTO public.student_edit_control (usn, ${field}, locked_by)
       VALUES ($1, false, $2)
       ON CONFLICT (usn) DO UPDATE SET ${field} = false, locked_by = EXCLUDED.locked_by`,
      [reqRow.usn, adminId]
    );

    await client.query('COMMIT');

    // Send automated notification to student
    createAndSendToUsns(
      {
        title: 'Semester Unlocked',
        message: `Your request to unlock Semester ${reqRow.semester} has been approved. You can now edit your academic records for this semester.`,
        link: '/student/profile/academics',
        created_by: adminId,
      },
      [reqRow.usn]
    ).catch((e) => console.warn('Unlock approval notification failed:', e?.message));

    return res.json({
      success: true,
      message: `Semester ${reqRow.semester} unlocked for ${reqRow.usn}.`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return sendCaughtError(res, err, 'Failed to approve request.');
  } finally {
    client.release();
  }
};

/**
 * PUT /placement/students/sem-unlock-requests/:id/reject (admin)
 * Reject the request. Optionally send notification with remarks to student.
 */
exports.reject = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) return sendValidationError(res, 'Invalid request ID.');

    const adminId = req.user?.id ?? null;
    const adminNotes = (req.body?.admin_notes || '').toString().trim() || null;
    const sendNotification = req.body?.send_notification === true;

    const { rows } = await client.query(
      `SELECT id, usn, semester, status FROM public.semester_unlock_requests WHERE id = $1`,
      [id]
    );
    if (!rows?.length) return res.status(404).json({ message: 'Request not found.' });
    if (rows[0].status !== 'pending') {
      return res.status(400).json({ message: `Request already ${rows[0].status}.` });
    }

    const reqRow = rows[0];

    await client.query(
      `UPDATE public.semester_unlock_requests
       SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), admin_notes = $3
       WHERE id = $1`,
      [id, adminId, adminNotes]
    );

    if (sendNotification && reqRow.usn) {
      const msg = adminNotes
        ? `Your request to unlock Semester ${reqRow.semester} has been rejected. Remarks: ${adminNotes}`
        : `Your request to unlock Semester ${reqRow.semester} has been rejected.`;
      createAndSendToUsns(
        {
          title: 'Semester Unlock Request Rejected',
          message: msg,
          link: '/student/profile/academics',
          created_by: adminId,
        },
        [reqRow.usn]
      ).catch((e) => console.warn('Reject notification failed:', e?.message));
    }

    return res.json({ success: true, message: 'Request rejected.' });
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to reject request.');
  } finally {
    client.release();
  }
};
