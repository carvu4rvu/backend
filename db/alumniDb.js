const { pool, queryMany, queryOne } = require('./query');

async function getAlumniConversionsMeta() {
  const [schools, programs] = await Promise.all([
    queryMany('SELECT id, name FROM schools ORDER BY name ASC'),
    queryMany(
      'SELECT id, name, school_id, min_duration_years, max_duration_years FROM programs ORDER BY name ASC'
    ),
  ]);
  return { schools, programs };
}

async function getStudentsBySchoolProgram(schoolId, programId, filters = {}) {
  const where = [
    's.school_id = $1',
    's.program_id = $2',
    'NOT EXISTS (SELECT 1 FROM alumni a WHERE a.student_id = s.usn)',
  ];
  const params = [schoolId, programId];
  let idx = 3;

  if (filters.year_of_joining != null && filters.year_of_joining !== '' && filters.year_of_joining !== 'all') {
    where.push(`s.year_of_joining = $${idx}`);
    params.push(Number(filters.year_of_joining));
    idx += 1;
  }
  if (filters.current_year != null && filters.current_year !== '' && filters.current_year !== 'all') {
    where.push(`s.current_year = $${idx}`);
    params.push(Number(filters.current_year));
    idx += 1;
  }
  if (filters.section != null && filters.section !== '' && filters.section !== 'all') {
    where.push(`UPPER(TRIM(s.section)) = UPPER(TRIM($${idx}))`);
    params.push(String(filters.section));
    idx += 1;
  }
  if (filters.opt_in === 'true' || filters.opt_in === true) {
    where.push('s.opt_in = true');
  } else if (filters.opt_in === 'false' || filters.opt_in === false) {
    where.push('(s.opt_in = false OR s.opt_in IS NULL)');
  }
  if (filters.has_personal_email === 'true' || filters.has_personal_email === true) {
    where.push(`s.personal_email IS NOT NULL AND TRIM(s.personal_email) <> ''`);
  }
  if (filters.search && String(filters.search).trim()) {
    where.push(
      `(s.usn ILIKE $${idx} OR s.full_name ILIKE $${idx} OR s.college_email ILIKE $${idx} OR s.personal_email ILIKE $${idx})`
    );
    params.push(`%${String(filters.search).trim()}%`);
    idx += 1;
  }
  if (filters.is_placed === 'true' || filters.is_placed === true) {
    where.push(
      'EXISTS (SELECT 1 FROM offers o WHERE o.student_id = s.usn AND o.is_accepted = true)'
    );
  } else if (filters.is_placed === 'false' || filters.is_placed === false) {
    where.push(
      'NOT EXISTS (SELECT 1 FROM offers o WHERE o.student_id = s.usn AND o.is_accepted = true)'
    );
  }

  return queryMany(
    `SELECT s.usn, s.full_name, s.college_email, s.personal_email, s.school_id, s.program_id,
            s.year_of_joining, s.current_year, s.section, s.opt_in
     FROM student_basic_details s
     WHERE ${where.join(' AND ')}
     ORDER BY s.year_of_joining DESC NULLS LAST, s.usn ASC`,
    params
  );
}

async function getConversionFilterMeta(schoolId, programId) {
  const baseWhere = `
    s.school_id = $1 AND s.program_id = $2
    AND NOT EXISTS (SELECT 1 FROM alumni a WHERE a.student_id = s.usn)
  `;
  const [years, currentYears, sections] = await Promise.all([
    queryMany(
      `SELECT DISTINCT s.year_of_joining AS year
       FROM student_basic_details s
       WHERE ${baseWhere} AND s.year_of_joining IS NOT NULL
       ORDER BY s.year_of_joining DESC`,
      [schoolId, programId]
    ),
    queryMany(
      `SELECT DISTINCT s.current_year AS year
       FROM student_basic_details s
       WHERE ${baseWhere} AND s.current_year IS NOT NULL
       ORDER BY s.current_year DESC`,
      [schoolId, programId]
    ),
    queryMany(
      `SELECT DISTINCT TRIM(s.section) AS section
       FROM student_basic_details s
       WHERE ${baseWhere} AND s.section IS NOT NULL AND TRIM(s.section) <> ''
       ORDER BY section ASC`,
      [schoolId, programId]
    ),
  ]);
  return {
    years: (years || []).map((r) => r.year),
    current_years: (currentYears || []).map((r) => r.year),
    sections: (sections || []).map((r) => r.section).filter(Boolean),
  };
}

async function getAlumniByStudentIds(usns) {
  if (!usns.length) return [];
  return queryMany(
    'SELECT student_id FROM alumni WHERE student_id = ANY($1::text[])',
    [usns]
  );
}

async function insertAlumni(payload) {
  const cols = Object.keys(payload);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO alumni (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`,
    cols.map((c) => payload[c])
  );
  return rows[0];
}

async function listAlumni(filters = {}) {
  const params = [];
  const where = ['1=1'];
  let idx = 1;
  if (filters.search) {
    where.push(
      `(full_name ILIKE $${idx} OR personal_email ILIKE $${idx} OR current_company ILIKE $${idx})`
    );
    params.push(`%${filters.search}%`);
    idx += 1;
  }
  if (filters.school_id) {
    where.push(`school_id = $${idx}`);
    params.push(filters.school_id);
    idx += 1;
  }
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT * FROM alumni WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC NULLS LAST
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );
  return rows;
}

async function countAlumni(filters = {}) {
  const params = [];
  const where = ['1=1'];
  let idx = 1;
  if (filters.search) {
    where.push(
      `(full_name ILIKE $${idx} OR personal_email ILIKE $${idx} OR current_company ILIKE $${idx})`
    );
    params.push(`%${filters.search}%`);
    idx += 1;
  }
  if (filters.school_id) {
    where.push(`school_id = $${idx}`);
    params.push(filters.school_id);
    idx += 1;
  }
  const row = await queryOne(
    `SELECT COUNT(*)::int AS cnt FROM alumni WHERE ${where.join(' AND ')}`,
    params
  );
  return row?.cnt ?? 0;
}

async function getAlumniById(id) {
  return queryOne('SELECT * FROM alumni WHERE id = $1', [id]);
}

async function updateAlumni(id, payload) {
  const keys = Object.keys(payload);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = [id, ...keys.map((k) => payload[k])];
  const { rows } = await pool.query(
    `UPDATE alumni SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

async function deleteAlumniRecord(id) {
  const row = await getAlumniById(id);
  if (!row) return null;
  await pool.query('DELETE FROM hr_recommendations WHERE alumni_id = $1', [id]);
  const { rowCount } = await pool.query('DELETE FROM alumni WHERE id = $1', [id]);
  return rowCount > 0 ? row : null;
}

async function insertRegistrationCode(payload) {
  const cols = Object.keys(payload);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO alumni_registration_codes (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`,
    cols.map((c) => payload[c])
  );
  return rows[0];
}

async function deactivateRegistrationCode(id) {
  const { rows } = await pool.query(
    `UPDATE alumni_registration_codes SET is_active = false, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

const ACCEPTED_OFFER_CAREER_SQL = `
  SELECT
    o.student_id,
    COALESCE(oc.company_name, pc.company_name, cap.company_name) AS company_name,
    COALESCE(p.designation, cap.designation, NULLIF(TRIM(o.job_type), '')) AS designation
  FROM offers o
  LEFT JOIN placement p ON p.id = o.placement_id
  LEFT JOIN capstone cap ON cap.id = o.capstone_id
  LEFT JOIN companies oc ON oc.id = o.company_id
  LEFT JOIN companies pc ON pc.id = p.company_id
  WHERE o.is_accepted = true
`;

async function getAcceptedOfferCareerForStudent(usn) {
  if (!usn) return null;
  return queryOne(
    `${ACCEPTED_OFFER_CAREER_SQL} AND o.student_id = $1
     ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST
     LIMIT 1`,
    [usn]
  );
}

/** Latest accepted offer per USN (company, role, hiring type, academic year). */
async function getAcceptedOffersByUsns(usns) {
  if (!usns?.length) return new Map();
  const rows = await queryMany(
    `SELECT DISTINCT ON (o.student_id)
            o.student_id,
            COALESCE(oc.company_name, pc.company_name, cap.company_name) AS company_name,
            COALESCE(p.designation, cap.designation, NULLIF(TRIM(o.job_type), '')) AS designation,
            COALESCE(NULLIF(TRIM(p.type_of_hiring), ''), NULLIF(TRIM(o.job_type), ''), 'Placement') AS job_type,
            COALESCE(o.academic_year, p.academic_year, cap.academic_year) AS academic_year,
            CASE
              WHEN o.placement_id IS NOT NULL THEN 'placement'
              WHEN o.capstone_id IS NOT NULL THEN 'capstone'
              ELSE 'offer'
            END AS offer_source
     FROM offers o
     LEFT JOIN placement p ON p.id = o.placement_id
     LEFT JOIN capstone cap ON cap.id = o.capstone_id
     LEFT JOIN companies oc ON oc.id = o.company_id
     LEFT JOIN companies pc ON pc.id = p.company_id
     WHERE o.student_id = ANY($1::text[]) AND o.is_accepted = true
     ORDER BY o.student_id, o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST`,
    [usns]
  );
  return new Map((rows || []).map((r) => [r.student_id, r]));
}

async function getStudentContextByUsns(usns) {
  if (!usns?.length) return new Map();
  const rows = await queryMany(
    `SELECT s.usn,
            s.college_email,
            s.year_of_joining,
            sch.name AS school_name,
            prg.name AS program_name
     FROM student_basic_details s
     LEFT JOIN schools sch ON sch.id = s.school_id
     LEFT JOIN programs prg ON prg.id = s.program_id
     WHERE s.usn = ANY($1::text[])`,
    [usns]
  );
  return new Map((rows || []).map((r) => [r.usn, r]));
}

async function getAllAlumniOrdered() {
  return queryMany('SELECT * FROM alumni ORDER BY full_name ASC NULLS LAST');
}

function mergeAlumniCareerFields(alumniRow, offerCareer) {
  if (!alumniRow) return alumniRow;
  const hasCompany = !!(alumniRow.current_company && String(alumniRow.current_company).trim());
  const hasRole = !!(alumniRow.current_designation && String(alumniRow.current_designation).trim());
  const placement = offerCareer
    ? {
        company: offerCareer.company_name || null,
        role: offerCareer.designation || null,
        job_type: offerCareer.job_type || null,
        academic_year: offerCareer.academic_year || null,
        source: offerCareer.offer_source || null,
      }
    : null;
  const displayCompany = hasCompany ? alumniRow.current_company : offerCareer?.company_name || null;
  const displayRole = hasRole ? alumniRow.current_designation : offerCareer?.designation || null;
  const hasPlacementDisplay = !!(displayCompany && String(displayCompany).trim()) || !!(displayRole && String(displayRole).trim());

  return {
    ...alumniRow,
    current_company: displayCompany,
    current_designation: displayRole,
    accepted_offer: placement,
    has_accepted_offer: !!offerCareer,
    has_placement_display: hasPlacementDisplay,
    placement_from_offer: !hasCompany && !hasRole && !!offerCareer,
  };
}

function buildAlumniListItem(alumniRow, offerCareer, studentContext) {
  const merged = mergeAlumniCareerFields(alumniRow, offerCareer);
  const isConverted = !!(merged.student_id && String(merged.student_id).trim());
  const batchYear = merged.graduation_year ?? studentContext?.year_of_joining ?? null;
  return {
    ...merged,
    usn: merged.student_id,
    batch_year: batchYear,
    school_name: studentContext?.school_name || merged.institution_name || null,
    program_name: studentContext?.program_name || null,
    college_email: studentContext?.college_email || null,
    year_of_joining: studentContext?.year_of_joining ?? null,
    alumni_source: isConverted ? 'converted' : 'registered',
  };
}

/** USNs like 1RUA22BSC006 must not be parsed with parseInt (which yields 1). */
function parseAlumniIdentifier(identifier) {
  const raw = String(identifier ?? '').trim();
  if (!raw) return { byId: false, value: raw };
  if (/^\d+$/.test(raw)) {
    return { byId: true, value: parseInt(raw, 10) };
  }
  return { byId: false, value: raw };
}

async function getAlumniByIdentifier(identifier, byId) {
  const resolved = typeof byId === 'boolean' ? { byId, value: identifier } : parseAlumniIdentifier(identifier);
  if (resolved.byId) {
    return queryOne('SELECT * FROM alumni WHERE id = $1', [resolved.value]);
  }
  return queryOne('SELECT * FROM alumni WHERE student_id = $1', [resolved.value]);
}

async function getAlumniIdByIdentifier(identifier, byId) {
  const resolved = typeof byId === 'boolean' ? { byId, value: identifier } : parseAlumniIdentifier(identifier);
  if (resolved.byId) {
    return queryOne('SELECT id FROM alumni WHERE id = $1', [resolved.value]);
  }
  return queryOne('SELECT id FROM alumni WHERE student_id = $1', [resolved.value]);
}

async function getAlumniByEmail(email) {
  const norm = String(email || '').trim().toLowerCase();
  if (!norm) return null;
  return queryOne(
    `SELECT * FROM alumni
     WHERE LOWER(personal_email) = $1
        OR (student_id IS NOT NULL AND student_id IN (
          SELECT usn FROM student_basic_details WHERE LOWER(college_email) = $1
        ))
     LIMIT 1`,
    [norm]
  );
}

async function getAlumniIdByEmail(email) {
  const row = await getAlumniByEmail(email);
  return row ? { id: row.id } : null;
}

async function getRegistrationCodes() {
  return queryMany('SELECT * FROM alumni_registration_codes ORDER BY created_at DESC NULLS LAST');
}

async function resolveAlumniIdByEmail(email) {
  const row = await getAlumniIdByEmail(email);
  return row?.id ?? null;
}

/**
 * Create or update an alumni user_login row for personal email (Gmail).
 * Matches self-serve alumni registration: usn NULL, role alumni, same password as college login.
 */
async function ensurePersonalAlumniLogin({ personalEmail, alumniRoleId, passwordHash }) {
  const emailNorm = String(personalEmail || '').trim().toLowerCase();
  if (!emailNorm) {
    return { created: false, loginId: null, error: 'Missing personal email' };
  }
  if (!passwordHash) {
    return { created: false, loginId: null, error: 'Missing password hash from college login' };
  }

  const existing = await queryOne(
    `SELECT ul.id, r.name AS role_name
     FROM user_login ul
     JOIN roles r ON r.id = ul.role_id
     WHERE lower(ul.email_id) = lower($1)`,
    [emailNorm]
  );

  if (existing) {
    const roleName = String(existing.role_name || '').toLowerCase();
    if (['company', 'admin', 'superadmin', 'vc'].includes(roleName)) {
      return {
        created: false,
        loginId: null,
        error: 'Personal email is already registered to a non-alumni account',
      };
    }
    await pool.query(
      `UPDATE user_login
       SET role_id = $1, password_hash = $2, usn = NULL, is_active = true, updated_at = NOW()
       WHERE id = $3`,
      [alumniRoleId, passwordHash, existing.id]
    );
    return { created: false, loginId: existing.id, updated: true };
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO user_login (usn, role_id, password_hash, email_id, is_active)
       VALUES (NULL, $1, $2, $3, true)
       RETURNING id`,
      [alumniRoleId, passwordHash, emailNorm]
    );
    return { created: true, loginId: rows[0].id };
  } catch (err) {
    if (err.code === '23505') {
      return { created: false, loginId: null, error: 'Personal email login already exists' };
    }
    if (err.constraint === 'user_login_email_id_check') {
      return {
        created: false,
        loginId: null,
        error:
          'Database blocks non-RVU emails on user_login. Allow personal emails for alumni logins or run the required migration.',
      };
    }
    throw err;
  }
}

async function getAcceptedOfferStudentIds(usns) {
  if (!usns.length) return [];
  const rows = await queryMany(
    'SELECT student_id FROM offers WHERE student_id = ANY($1::text[]) AND is_accepted = true',
    [usns]
  );
  return rows.map((r) => r.student_id);
}

async function insertHrRecommendation(payload) {
  const cols = Object.keys(payload);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO hr_recommendations (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`,
    cols.map((c) => payload[c])
  );
  return rows[0];
}

async function getHrRecommendationsByAlumniId(alumniId) {
  return queryMany(
    'SELECT * FROM hr_recommendations WHERE alumni_id = $1 ORDER BY created_at DESC NULLS LAST',
    [alumniId]
  );
}

async function insertConnectionRequest(payload) {
  const cols = Object.keys(payload);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO alumni_connection_requests (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`,
    cols.map((c) => payload[c])
  );
  return rows[0];
}

async function getConnectionRequests(statusFilter) {
  let sql = 'SELECT * FROM alumni_connection_requests';
  const params = [];
  if (statusFilter) {
    sql += ' WHERE status = $1';
    params.push(statusFilter);
  }
  sql += ' ORDER BY created_at DESC NULLS LAST';
  return queryMany(sql, params);
}

async function getAlumniByIds(ids) {
  if (!ids.length) return [];
  return queryMany(
    'SELECT id, full_name, personal_email, current_company, current_designation FROM alumni WHERE id = ANY($1::int[])',
    [ids]
  );
}

async function getStudentsBriefByUsns(usns) {
  if (!usns.length) return [];
  return queryMany(
    'SELECT usn, full_name, college_email FROM student_basic_details WHERE usn = ANY($1::text[])',
    [usns]
  );
}

async function updateConnectionRequest(id, payload) {
  const keys = Object.keys(payload).filter((k) => payload[k] !== undefined);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = [id, ...keys.map((k) => payload[k])];
  const { rows } = await pool.query(
    `UPDATE alumni_connection_requests SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

async function getHrRecommendations() {
  return queryMany(`
    SELECT hr.*,
           a.id AS alumni_ref_id, a.full_name AS alumni_full_name,
           a.current_company AS alumni_current_company, a.personal_email AS alumni_personal_email
    FROM hr_recommendations hr
    LEFT JOIN alumni a ON a.id = hr.alumni_id
    ORDER BY hr.created_at DESC NULLS LAST
  `);
}

module.exports = {
  getAlumniConversionsMeta,
  getStudentsBySchoolProgram,
  getConversionFilterMeta,
  getAlumniByStudentIds,
  insertAlumni,
  listAlumni,
  countAlumni,
  getAlumniById,
  updateAlumni,
  deleteAlumniRecord,
  insertRegistrationCode,
  deactivateRegistrationCode,
  getAllAlumniOrdered,
  getAcceptedOfferCareerForStudent,
  getAcceptedOffersByUsns,
  getStudentContextByUsns,
  mergeAlumniCareerFields,
  buildAlumniListItem,
  parseAlumniIdentifier,
  getAlumniByIdentifier,
  getAlumniIdByIdentifier,
  getAlumniByEmail,
  getAlumniIdByEmail,
  getRegistrationCodes,
  resolveAlumniIdByEmail,
  ensurePersonalAlumniLogin,
  getAcceptedOfferStudentIds,
  insertHrRecommendation,
  getHrRecommendationsByAlumniId,
  insertConnectionRequest,
  getConnectionRequests,
  getAlumniByIds,
  getStudentsBriefByUsns,
  updateConnectionRequest,
  getHrRecommendations,
};
