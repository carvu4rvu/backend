const { pool, queryOne, queryMany, forEachChunk } = require('./query');

const USN_TABLES = new Set([
  'student_education_history',
  'student_education_gaps',
  'student_semester_academics',
  'student_internships',
  'student_trainings',
  'student_certifications',
  'student_publications',
  'student_extra_curricular_activities',
  'student_other_experiences',
  'student_trainings',
  'student_publications',
  'student_parent_details',
  'student_summer_immersion',
  'student_summer_internship',
  'student_profile_details',
  'capstone',
]);

function assertUsnTable(table) {
  if (!USN_TABLES.has(table)) {
    throw new Error(`Invalid student table: ${table}`);
  }
}

/** Supabase-compatible { error } for delete-by-usn flows. */
async function deleteByUsn(table, usn) {
  assertUsnTable(table);
  try {
    await pool.query(`DELETE FROM ${table} WHERE usn = $1`, [usn]);
    return { error: null };
  } catch (error) {
    return { error };
  }
}

/** Supabase-compatible { data, error } for parallel fetches. */
async function selectByUsn(table, usn, options = {}) {
  assertUsnTable(table);
  try {
    let sql = `SELECT * FROM ${table} WHERE usn = $1`;
    const params = [usn];
    if (options.orderBy) {
      sql += ` ORDER BY ${options.orderBy} ASC`;
    }
    const rows = await queryMany(sql, params);
    return { data: rows, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

async function selectOneByUsn(table, usn) {
  assertUsnTable(table);
  return queryOne(`SELECT * FROM ${table} WHERE usn = $1 LIMIT 1`, [usn]);
}

async function insertRows(table, rows) {
  if (!rows?.length) return { data: [], error: null };
  assertUsnTable(table);
  try {
    const cols = Object.keys(rows[0]);
    const values = [];
    const params = [];
    let idx = 1;
    for (const row of rows) {
      const ph = cols.map(() => `$${idx++}`);
      values.push(`(${ph.join(', ')})`);
      for (const c of cols) params.push(row[c] ?? null);
    }
    const { rows: inserted } = await pool.query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values.join(', ')} RETURNING *`,
      params
    );
    return { data: inserted, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

function buildSetClause(updateData, startIdx = 2) {
  const keys = Object.keys(updateData);
  const setClause = keys.map((k, i) => `${k} = $${startIdx + i}`).join(', ');
  return { keys, setClause };
}

async function getBasicByUsn(usn, columns = '*') {
  const cols = Array.isArray(columns) ? columns.join(', ') : columns;
  return queryOne(`SELECT ${cols} FROM student_basic_details WHERE usn = $1`, [usn]);
}

async function existsBasicByUsn(usn) {
  return queryOne('SELECT usn FROM student_basic_details WHERE usn = $1', [usn]);
}

async function getExistingUsns(usns) {
  if (!usns?.length) return [];
  return forEachChunk(usns, async (chunk) => {
    const { rows } = await pool.query(
      'SELECT usn FROM student_basic_details WHERE usn = ANY($1::text[])',
      [chunk]
    );
    return rows;
  });
}

async function getUsnsBySchoolId(schoolId) {
  return queryMany('SELECT usn FROM student_basic_details WHERE school_id = $1', [schoolId]);
}

async function getUsnsByProgramId(programId) {
  return queryMany('SELECT usn FROM student_basic_details WHERE program_id = $1', [programId]);
}

async function getStudentSchoolProgramIds() {
  return queryMany('SELECT school_id, program_id FROM student_basic_details');
}

async function updateBasicDetails(usn, updateData) {
  const keys = Object.keys(updateData);
  if (!keys.length) return null;
  const { setClause } = buildSetClause(updateData, 2);
  const params = [usn, ...keys.map((k) => updateData[k])];
  const { rows } = await pool.query(
    `UPDATE student_basic_details SET ${setClause} WHERE usn = $1 RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

async function insertBasicDetails(row) {
  const keys = Object.keys(row);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO student_basic_details (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    keys.map((k) => row[k])
  );
  return rows[0] ?? null;
}

async function insertBasicDetailsBulk(rows, returning = 'usn') {
  if (!rows?.length) return [];
  const keys = Object.keys(rows[0]);
  const values = [];
  const params = [];
  let idx = 1;
  for (const row of rows) {
    const ph = keys.map(() => `$${idx++}`);
    values.push(`(${ph.join(', ')})`);
    for (const k of keys) params.push(row[k] ?? null);
  }
  const returnCols = returning === '*' ? '*' : returning;
  const { rows: inserted } = await pool.query(
    `INSERT INTO student_basic_details (${keys.join(', ')}) VALUES ${values.join(', ')} RETURNING ${returnCols}`,
    params
  );
  return inserted;
}

module.exports = {
  deleteByUsn,
  selectByUsn,
  selectOneByUsn,
  insertRows,
  getBasicByUsn,
  existsBasicByUsn,
  getExistingUsns,
  getUsnsBySchoolId,
  getUsnsByProgramId,
  getStudentSchoolProgramIds,
  updateBasicDetails,
  insertBasicDetails,
  insertBasicDetailsBulk,
};
