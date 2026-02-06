const pool = require('../config/db');
const { sendValidationError, sendLocked, sendCaughtError } = require('../utils/apiErrorResponse');

const SEM_LOCK_FIELDS = [
  'is_sem1_locked',
  'is_sem2_locked',
  'is_sem3_locked',
  'is_sem4_locked',
  'is_sem5_locked',
  'is_sem6_locked',
  'is_sem7_locked',
  'is_sem8_locked',
];

// All non-semester boolean locks from student_edit_control + lock_reason
const SECTION_LOCK_FIELDS = [
  'is_basic_info_locked',
  'is_contacts_locked',
  'is_profile_details_locked',
  'is_social_links_locked',
  'is_parent_details_locked',
  'is_education_history_locked',
  'is_education_gaps_locked',
  'is_course_academics_locked',
  'is_extra_curricular_locked',
  'is_projects_locked',
  'is_certifications_locked',
  'is_internships_locked',
  'is_trainings_locked',
  'is_other_experiences_locked',
  'is_publications_locked',
  'is_placements_locked',
];

const OTHER_ALLOWED_FIELDS = [
  'lock_reason',
  // pseudo-field mapped to user_login.is_active (not stored in student_edit_control)
  'login_is_active',
];

const ALLOWED_FIELDS = new Set([
  ...SEM_LOCK_FIELDS,
  ...SECTION_LOCK_FIELDS,
  ...OTHER_ALLOWED_FIELDS,
]);

/**
 * GET /placement/students/profile-locks
 * Returns all students with their student_edit_control row (if present).
 */
exports.getProfileLocks = async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `
        SELECT
          s.usn,
          s.full_name,
          s.college_email,
          u.is_active AS login_is_active,
          c.is_basic_info_locked,
          c.is_contacts_locked,
          c.is_profile_details_locked,
          c.is_social_links_locked,
          c.is_parent_details_locked,
          c.is_education_history_locked,
          c.is_education_gaps_locked,
          c.is_course_academics_locked,
          c.is_extra_curricular_locked,
          c.is_projects_locked,
          c.is_certifications_locked,
          c.is_internships_locked,
          c.is_trainings_locked,
          c.is_other_experiences_locked,
          c.is_publications_locked,
          c.is_placements_locked,
          c.is_sem1_locked,
          c.is_sem2_locked,
          c.is_sem3_locked,
          c.is_sem4_locked,
          c.is_sem5_locked,
          c.is_sem6_locked,
          c.is_sem7_locked,
          c.is_sem8_locked,
          c.locked_by,
          c.lock_reason
        FROM public.student_basic_details s
        LEFT JOIN public.student_edit_control c
          ON c.usn = s.usn
        LEFT JOIN public.user_login u
          ON u.usn = s.usn
        ORDER BY s.usn ASC
      `
    );
    return res.json({ rows });
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to fetch profile locks.');
  } finally {
    client.release();
  }
};

/**
 * POST /placement/students/profile-locks/sync
 * Inserts missing student_edit_control rows for active students.
 */
exports.syncProfileLocks = async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `
        INSERT INTO public.student_edit_control (usn)
        SELECT s.usn
        FROM public.student_basic_details s
        WHERE NOT EXISTS (
          SELECT 1 FROM public.student_edit_control c WHERE c.usn = s.usn
        )
      `
    );
    return res.json({ inserted: result.rowCount || 0 });
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to sync profile locks.');
  } finally {
    client.release();
  }
};

/**
 * PUT /placement/students/profile-locks/:usn
 * Updates semester-wise locks for a student.
 */
exports.updateProfileLocks = async (req, res) => {
  const client = await pool.connect();
  try {
    const usn = (req.params.usn || '').toString().trim().toUpperCase();
    if (!usn) return sendValidationError(res, 'USN is required.');

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const patch = {};
    let loginActive = null;

    for (const [k, v] of Object.entries(body)) {
      if (!ALLOWED_FIELDS.has(k)) continue;
      if (k === 'login_is_active') {
        loginActive = !!v;
        continue;
      }
      if (k === 'lock_reason') {
        patch[k] = v == null ? null : String(v);
      } else {
        patch[k] = !!v;
      }
    }

    const keys = Object.keys(patch);
    if (!keys.length && loginActive == null) return sendValidationError(res, 'No valid fields provided.');

    // Ensure control row exists
    await client.query(
      `
        INSERT INTO public.student_edit_control (usn)
        VALUES ($1)
        ON CONFLICT (usn) DO NOTHING
      `,
      [usn]
    );

    const adminId = req.user?.id ?? null;

    // Build dynamic update
    const setParts = [];
    const values = [usn];
    let idx = 2;

    for (const k of keys) {
      setParts.push(`${k} = $${idx}`);
      values.push(patch[k]);
      idx += 1;
    }

    // Always stamp locked_by when updating (for audit)
    setParts.push(`locked_by = $${idx}`);
    values.push(adminId);
    idx += 1;

    if (setParts.length > 0) {
      const { rows } = await client.query(
        `
          UPDATE public.student_edit_control
          SET ${setParts.join(', ')}
          WHERE usn = $1
          RETURNING usn,
                    is_course_academics_locked,
                    is_sem1_locked, is_sem2_locked, is_sem3_locked, is_sem4_locked,
                    is_sem5_locked, is_sem6_locked, is_sem7_locked, is_sem8_locked,
                    locked_by, lock_reason
        `,
        values
      );
      if (!rows.length) return sendValidationError(res, 'Failed to update locks.');
    }

    if (loginActive != null) {
      await client.query(
        `UPDATE public.user_login SET is_active = $2 WHERE usn = $1`,
        [usn, loginActive]
      );
    }

    return res.json({ success: true });
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to update profile locks.');
  } finally {
    client.release();
  }
};

/**
 * Guard helper for student-side edits.
 * Used by other controllers to block edits when a semester is locked.
 */
exports.assertSemesterNotLocked = async (client, usn, semester, res) => {
  const semNum = Number(semester);
  if (!usn || !semNum || semNum < 1 || semNum > 8) return true;
  const field = `is_sem${semNum}_locked`;
  const { rows } = await client.query(
    `SELECT ${field} AS locked FROM public.student_edit_control WHERE usn = $1`,
    [String(usn).toUpperCase()]
  );
  if (rows?.[0]?.locked === true) {
    sendLocked(res, `Semester ${semNum} is locked. You have view-only access.`);
    return false;
  }
  return true;
};

