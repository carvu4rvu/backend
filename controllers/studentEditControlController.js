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
 * Returns students with their student_edit_control row with pagination and search.
 */
exports.getProfileLocks = async (req, res) => {
  const client = await pool.connect();
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim().toLowerCase();

    let whereClause = '';
    const queryParams = [];
    if (search) {
      whereClause = `
        WHERE s.usn ILIKE $1 
           OR s.full_name ILIKE $1 
           OR s.college_email ILIKE $1
      `;
      queryParams.push(`%${search}%`);
    }

    const countQuery = `
      SELECT COUNT(*) 
      FROM public.student_basic_details s
      ${whereClause}
    `;
    const { rows: countRows } = await client.query(countQuery, queryParams);
    const total = parseInt(countRows[0].count, 10);

    const dataQuery = `
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
        COALESCE(ap.full_name, ul.email_id::text) AS locked_by_name,
        c.lock_reason
      FROM public.student_basic_details s
      LEFT JOIN public.student_edit_control c
        ON c.usn = s.usn
      LEFT JOIN public.user_login u
        ON u.usn = s.usn
      LEFT JOIN public.user_login ul
        ON ul.id = c.locked_by
      LEFT JOIN public.admin_profiles ap
        ON ap.user_login_id = ul.id
      ${whereClause}
      ORDER BY s.usn ASC
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;

    queryParams.push(limit, offset);
    const { rows } = await client.query(dataQuery, queryParams);

    return res.json({ 
      rows,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
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
 * GET /placement/students/:usn/edit-control (admin)
 * Returns edit control (lock flags) for one student.
 */
exports.getEditControlByUsn = async (req, res) => {
  const client = await pool.connect();
  try {
    const usn = (req.params.usn || '').toString().trim().toUpperCase();
    if (!usn) return sendValidationError(res, 'USN is required.');

    const { rows } = await client.query(
      `
        SELECT
          c.usn,
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
          c.is_sem1_locked, c.is_sem2_locked, c.is_sem3_locked, c.is_sem4_locked,
          c.is_sem5_locked, c.is_sem6_locked, c.is_sem7_locked, c.is_sem8_locked,
          c.lock_reason
        FROM public.student_edit_control c
        LEFT JOIN public.user_login u ON u.usn = c.usn
        WHERE c.usn = $1
      `,
      [usn]
    );

    if (!rows || rows.length === 0) {
      return res.json({
        usn,
        login_is_active: true,
        is_basic_info_locked: false,
        is_contacts_locked: false,
        is_profile_details_locked: false,
        is_social_links_locked: false,
        is_parent_details_locked: false,
        is_education_history_locked: false,
        is_education_gaps_locked: false,
        is_course_academics_locked: false,
        is_extra_curricular_locked: false,
        is_projects_locked: false,
        is_certifications_locked: false,
        is_internships_locked: false,
        is_trainings_locked: false,
        is_other_experiences_locked: false,
        is_publications_locked: false,
        is_placements_locked: false,
        is_sem1_locked: false,
        is_sem2_locked: false,
        is_sem3_locked: false,
        is_sem4_locked: false,
        is_sem5_locked: false,
        is_sem6_locked: false,
        is_sem7_locked: false,
        is_sem8_locked: false,
        lock_reason: null,
      });
    }
    return res.json(rows[0]);
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to fetch edit control.');
  } finally {
    client.release();
  }
};

/**
 * GET /student/profile/edit-control (student own)
 * Returns edit control for the authenticated student (req.user.usn).
 */
exports.getOwnEditControl = async (req, res) => {
  const usn = (req.user?.usn || '').toString().trim().toUpperCase();
  if (!usn) return res.status(401).json({ message: 'Unauthorized.' });
  req.params = { ...(req.params || {}), usn };
  return exports.getEditControlByUsn(req, res);
};

/**
 * GET /placement/students/profile-locks/batch-count
 * Returns the count of students matching the batch filters.
 */
exports.getBatchLockCount = async (req, res) => {
  const client = await pool.connect();
  try {
    const { school_id, program_id, year_of_joining, major_id, specialization_id, minor_id } = req.query;

    let whereParts = [];
    const params = [];
    let idx = 1;

    if (school_id) { whereParts.push(`school_id = $${idx++}`); params.push(school_id); }
    if (program_id) { whereParts.push(`program_id = $${idx++}`); params.push(program_id); }
    if (year_of_joining) { whereParts.push(`year_of_joining = $${idx++}`); params.push(year_of_joining); }
    if (major_id) { whereParts.push(`major_id = $${idx++}`); params.push(major_id); }
    if (specialization_id) { whereParts.push(`specialization_id = $${idx++}`); params.push(specialization_id); }
    if (minor_id) { whereParts.push(`minor_id = $${idx++}`); params.push(minor_id); }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    const { rows } = await client.query(`SELECT COUNT(*) FROM public.student_basic_details ${whereClause}`, params);

    return res.json({ count: parseInt(rows[0].count, 10) });
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to fetch batch count.');
  } finally {
    client.release();
  }
};

/**
 * POST /placement/students/profile-locks/batch-update
 * Updates lock flags for a batch of students matching the filters.
 */
exports.batchUpdateProfileLocks = async (req, res) => {
  const client = await pool.connect();
  try {
    const { filters, locks } = req.body;
    if (!locks || typeof locks !== 'object') return sendValidationError(res, 'No lock fields provided.');

    const { school_id, program_id, year_of_joining, major_id, specialization_id, minor_id } = filters || {};

    let whereParts = [];
    const whereParams = [];
    let wIdx = 1;

    if (school_id) { whereParts.push(`school_id = $${wIdx++}`); whereParams.push(school_id); }
    if (program_id) { whereParts.push(`program_id = $${wIdx++}`); whereParams.push(program_id); }
    if (year_of_joining) { whereParts.push(`year_of_joining = $${wIdx++}`); whereParams.push(year_of_joining); }
    if (major_id) { whereParts.push(`major_id = $${wIdx++}`); whereParams.push(major_id); }
    if (specialization_id) { whereParts.push(`specialization_id = $${wIdx++}`); whereParams.push(specialization_id); }
    if (minor_id) { whereParts.push(`minor_id = $${wIdx++}`); whereParams.push(minor_id); }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    // 1. Identify target USNs
    const { rows: targetStudents } = await client.query(
      `SELECT usn FROM public.student_basic_details ${whereClause}`,
      whereParams
    );
    const usns = targetStudents.map(s => s.usn);
    if (usns.length === 0) return res.json({ updated: 0 });

    // 2. Ensure control rows exist for all target USNs
    await client.query(
      `
        INSERT INTO public.student_edit_control (usn)
        SELECT unnest($1::text[])
        ON CONFLICT (usn) DO NOTHING
      `,
      [usns]
    );

    // 3. Build Update Query
    const patch = {};
    let loginActive = null;
    for (const [k, v] of Object.entries(locks)) {
      if (!ALLOWED_FIELDS.has(k)) continue;
      if (k === 'login_is_active') { loginActive = !!v; continue; }
      if (k === 'lock_reason') { patch[k] = v == null ? null : String(v); }
      else { patch[k] = !!v; }
    }

    const setParts = [];
    const updateParams = [usns];
    let uIdx = 2;

    for (const [k, v] of Object.entries(patch)) {
      setParts.push(`${k} = $${uIdx++}`);
      updateParams.push(v);
    }

    // Audit
    const adminId = req.user?.id ?? null;
    setParts.push(`locked_by = $${uIdx++}`);
    updateParams.push(adminId);

    await client.query('BEGIN');
    try {
      if (setParts.length > 0) {
        await client.query(
          `UPDATE public.student_edit_control SET ${setParts.join(', ')} WHERE usn = ANY($1)`,
          updateParams
        );
      }
      if (loginActive !== null) {
        await client.query(
          `UPDATE public.user_login SET is_active = $2 WHERE usn = ANY($1)`,
          [usns, loginActive]
        );
      }
      await client.query('COMMIT');
      return res.json({ updated: usns.length });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to batch update profile locks.');
  } finally {
    client.release();
  }
};

