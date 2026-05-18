const { pool, queryMany, queryOne } = require('./query');

async function getAllPoliciesWithNames() {
  const { rows } = await pool.query(`
    SELECT bap.*, sch.name AS school_name, prg.name AS program_name
    FROM batch_academic_policies bap
    LEFT JOIN schools sch ON sch.id = bap.school_id
    LEFT JOIN programs prg ON prg.id = bap.program_id
    ORDER BY bap.joining_year DESC NULLS LAST
  `);
  return rows;
}

async function getStudentsForBatchKeys() {
  return queryMany('SELECT usn, school_id, program_id, year_of_joining FROM student_basic_details');
}

async function getAlumniStudentIds() {
  const rows = await queryMany(
    'SELECT student_id FROM alumni WHERE student_id IS NOT NULL'
  );
  return rows.map((r) => r.student_id);
}

async function upsertPolicy(id, payload) {
  if (id) {
    const { rows } = await pool.query(
      `UPDATE batch_academic_policies SET
         joining_year = $2, school_id = $3, program_id = $4,
         summer_immersion = $5, summer_internship = $6, capstone = $7,
         placement = $8, alumni = $9, remarks = $10, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        id,
        payload.joining_year,
        payload.school_id,
        payload.program_id,
        payload.summer_immersion,
        payload.summer_internship,
        payload.capstone,
        payload.placement,
        payload.alumni,
        payload.remarks,
      ]
    );
    return rows[0];
  }
  const { rows } = await pool.query(
    `INSERT INTO batch_academic_policies (
       joining_year, school_id, program_id, summer_immersion, summer_internship,
       capstone, placement, alumni, remarks
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      payload.joining_year,
      payload.school_id,
      payload.program_id,
      payload.summer_immersion,
      payload.summer_internship,
      payload.capstone,
      payload.placement,
      payload.alumni,
      payload.remarks,
    ]
  );
  return rows[0];
}

async function updateStudentEligibilityByBatch(schoolId, programId, joiningYear, flags) {
  const { rowCount } = await pool.query(
    `UPDATE student_basic_details SET
       is_summer_immersion_eligible = $4,
       is_summer_internship_eligible = $5,
       is_capstone_eligible = $6,
       is_placement_eligible = $7,
       updated_at = NOW()
     WHERE school_id = $1 AND program_id = $2 AND year_of_joining = $3`,
    [
      schoolId,
      programId,
      joiningYear,
      flags.is_summer_immersion_eligible,
      flags.is_summer_internship_eligible,
      flags.is_capstone_eligible,
      flags.is_placement_eligible,
    ]
  );
  return rowCount;
}

async function fetchStudentsEligibilityPage({ limit, offset, schoolId, programId, search }) {
  const params = [];
  const where = ['1=1'];
  let idx = 1;
  if (schoolId != null) {
    where.push(`s.school_id = $${idx}`);
    params.push(schoolId);
    idx += 1;
  }
  if (programId != null) {
    where.push(`s.program_id = $${idx}`);
    params.push(programId);
    idx += 1;
  }
  if (search) {
    where.push(`(s.usn ILIKE $${idx} OR s.full_name ILIKE $${idx} OR s.college_email ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx += 1;
  }
  const whereClause = where.join(' AND ');
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM student_basic_details s WHERE ${whereClause}`,
    params
  );
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT s.usn, s.full_name, s.college_email, s.school_id, s.program_id, s.year_of_joining,
            s.is_summer_immersion_eligible, s.is_summer_internship_eligible,
            s.is_capstone_eligible, s.is_placement_eligible,
            sch.name AS school_name, sch.abbreviation AS school_abbr, prg.name AS program_name
     FROM student_basic_details s
     LEFT JOIN schools sch ON sch.id = s.school_id
     LEFT JOIN programs prg ON prg.id = s.program_id
     WHERE ${whereClause}
     ORDER BY s.full_name ASC NULLS LAST
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );
  return { students: rows, total: countRes.rows[0]?.total ?? 0 };
}

async function updateStudentEligibilityByUsn(usn, payload) {
  const keys = Object.keys(payload);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = [usn, ...keys.map((k) => payload[k])];
  const { rows } = await pool.query(
    `UPDATE student_basic_details SET ${sets.join(', ')}, updated_at = NOW()
     WHERE usn = $1
     RETURNING usn, full_name, is_summer_immersion_eligible, is_summer_internship_eligible,
               is_capstone_eligible, is_placement_eligible`,
    values
  );
  return rows[0] ?? null;
}

async function bulkUpdateStudentEligibility(usns, payload) {
  const keys = Object.keys(payload);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = [...keys.map((k) => payload[k]), usns];
  const { rowCount } = await pool.query(
    `UPDATE student_basic_details SET ${sets.join(', ')}, updated_at = NOW()
     WHERE usn = ANY($${keys.length + 2}::text[])`,
    values
  );
  return rowCount;
}

async function getStudentPolicyContext(usn) {
  return queryOne(
    `SELECT school_id, program_id, year_of_joining, opt_in,
            is_summer_immersion_eligible, is_summer_internship_eligible,
            is_capstone_eligible, is_placement_eligible
     FROM student_basic_details WHERE usn = $1`,
    [usn]
  );
}

async function getBatchPolicy(schoolId, programId, joiningYear) {
  return queryOne(
    `SELECT summer_immersion, summer_internship, capstone, placement
     FROM batch_academic_policies
     WHERE school_id = $1 AND program_id = $2 AND joining_year = $3`,
    [schoolId, programId, joiningYear]
  );
}

async function syncPoliciesFromCatalog() {
  const programs = await queryMany('SELECT id, school_id FROM programs');
  const years = await queryMany(
    'SELECT DISTINCT year_of_joining FROM student_basic_details WHERE year_of_joining IS NOT NULL'
  );
  const uniqueYears = years.map((y) => y.year_of_joining);
  const existing = await queryMany(
    'SELECT id, school_id, program_id, joining_year FROM batch_academic_policies'
  );
  const existingKeys = new Set(
    existing.map((p) => `${p.school_id}-${p.program_id}-${p.joining_year}`)
  );
  const toInsert = [];
  programs.forEach((p) => {
    uniqueYears.forEach((year) => {
      const k = `${p.school_id}-${p.id}-${year}`;
      if (existingKeys.has(k)) return;
      toInsert.push({
        school_id: p.school_id,
        program_id: p.id,
        joining_year: year,
        summer_immersion: false,
        summer_internship: false,
        capstone: false,
        placement: false,
        alumni: false,
      });
    });
  });
  if (toInsert.length) {
    for (const row of toInsert) {
      await pool.query(
        `INSERT INTO batch_academic_policies (
           school_id, program_id, joining_year, summer_immersion, summer_internship, capstone, placement, alumni
         ) VALUES ($1,$2,$3,false,false,false,false,false)
         ON CONFLICT DO NOTHING`,
        [row.school_id, row.program_id, row.joining_year]
      );
    }
  }
  return toInsert.length;
}

module.exports = {
  getAllPoliciesWithNames,
  getStudentsForBatchKeys,
  getAlumniStudentIds,
  upsertPolicy,
  updateStudentEligibilityByBatch,
  fetchStudentsEligibilityPage,
  updateStudentEligibilityByUsn,
  bulkUpdateStudentEligibility,
  getStudentPolicyContext,
  getBatchPolicy,
  syncPoliciesFromCatalog,
};
