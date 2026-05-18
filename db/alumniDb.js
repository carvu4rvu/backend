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

async function getStudentsBySchoolProgram(schoolId, programId) {
  return queryMany(
    `SELECT usn, full_name, college_email, personal_email, school_id, program_id, year_of_joining, opt_in
     FROM student_basic_details
     WHERE school_id = $1 AND program_id = $2
     ORDER BY usn ASC`,
    [schoolId, programId]
  );
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

async function getAllAlumniOrdered() {
  return queryMany('SELECT * FROM alumni ORDER BY full_name ASC NULLS LAST');
}

async function getAlumniByIdentifier(identifier, byId) {
  if (byId) {
    return queryOne('SELECT * FROM alumni WHERE id = $1', [identifier]);
  }
  return queryOne('SELECT * FROM alumni WHERE student_id = $1', [identifier]);
}

async function getAlumniIdByIdentifier(identifier, byId) {
  if (byId) {
    return queryOne('SELECT id FROM alumni WHERE id = $1', [identifier]);
  }
  return queryOne('SELECT id FROM alumni WHERE student_id = $1', [identifier]);
}

async function getAlumniByEmail(email) {
  return queryOne('SELECT * FROM alumni WHERE LOWER(personal_email) = LOWER($1)', [email]);
}

async function getAlumniIdByEmail(email) {
  return queryOne('SELECT id FROM alumni WHERE LOWER(personal_email) = LOWER($1)', [email]);
}

async function getRegistrationCodes() {
  return queryMany('SELECT * FROM alumni_registration_codes ORDER BY created_at DESC NULLS LAST');
}

async function resolveAlumniIdByEmail(email) {
  const row = await getAlumniIdByEmail(email);
  return row?.id ?? null;
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
  getAlumniByStudentIds,
  insertAlumni,
  listAlumni,
  countAlumni,
  getAlumniById,
  updateAlumni,
  insertRegistrationCode,
  deactivateRegistrationCode,
  getAllAlumniOrdered,
  getAlumniByIdentifier,
  getAlumniIdByIdentifier,
  getAlumniByEmail,
  getAlumniIdByEmail,
  getRegistrationCodes,
  resolveAlumniIdByEmail,
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
