const { pool, query, queryOne, queryMany, forEachChunk, chunkArray } = require('./query');
const catalogDb = require('./catalogDb');

const COMPANY_LIST_COLS =
  'id, company_name, description, company_type, address, website, linkedin, remarks, company_logo_link, created_at, updated_at';

async function getDriveForNotification(driveId) {
  return queryOne(
    `SELECT pd.job_description, pd.last_date_to_registration, pd.event_datetime, c.company_name
     FROM placements_drives pd
     LEFT JOIN companies c ON c.id = pd.company_id
     WHERE pd.id = $1`,
    [driveId]
  );
}

async function getStudentOptIn(usn) {
  return queryOne('SELECT opt_in FROM student_basic_details WHERE usn = $1', [usn]);
}

async function getStudentForApply(usn) {
  return queryOne(
    `SELECT s.usn, s.opt_in, s.school_id, s.program_id, s.major_id, s.specialization_id,
            s.year_of_joining, s.current_year, s.current_semester,
            prg.max_duration_years
     FROM student_basic_details s
     LEFT JOIN programs prg ON prg.id = s.program_id
     WHERE s.usn = $1`,
    [usn]
  );
}

async function getProcessByDriveAndUsn(driveId, usn) {
  return queryOne(
    'SELECT * FROM student_placement_process WHERE placement_drive_id = $1 AND usn = $2',
    [driveId, usn]
  );
}

async function updateProcessById(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = [id, ...keys.map((k) => fields[k])];
  const { rows } = await pool.query(
    `UPDATE student_placement_process SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

async function insertProcess(row) {
  const { rows } = await pool.query(
    `INSERT INTO student_placement_process (usn, placement_drive_id, is_eligible, registration_status)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [row.usn, row.placement_drive_id, row.is_eligible, row.registration_status]
  );
  return rows[0];
}

async function getDriveEligibilityCriteria(driveId) {
  const row = await queryOne('SELECT eligibility_criteria FROM placements_drives WHERE id = $1', [driveId]);
  return row?.eligibility_criteria ?? null;
}

async function updateDriveEligibilityCriteria(driveId, criteria) {
  const { rows } = await pool.query(
    `UPDATE placements_drives SET eligibility_criteria = $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [driveId, JSON.stringify(criteria)]
  );
  return rows[0] ?? null;
}

async function getExistingProcessUsns(driveId) {
  const rows = await queryMany(
    'SELECT usn FROM student_placement_process WHERE placement_drive_id = $1',
    [driveId]
  );
  return rows.map((r) => r.usn);
}

async function insertProcessBatch(rows) {
  if (!rows.length) return;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = [];
    const params = [];
    let idx = 1;
    chunk.forEach((r) => {
      values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3})`);
      params.push(r.usn, r.placement_drive_id, r.is_eligible, r.registration_status);
      idx += 4;
    });
    await pool.query(
      `INSERT INTO student_placement_process (usn, placement_drive_id, is_eligible, registration_status)
       VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`,
      params
    );
  }
}

async function fetchAllDrivesRows() {
  const { rows } = await pool.query(
    `SELECT pd.*, row_to_json(c.*) AS company
     FROM placements_drives pd
     LEFT JOIN companies c ON c.id = pd.company_id
     ORDER BY pd.created_at DESC NULLS LAST`
  );
  return rows.map((row) => {
    const { company, ...rest } = row;
    return { ...rest, company: company && typeof company === 'object' ? company : null };
  });
}

async function getRegistrationCountsByDrive(driveIds) {
  if (!driveIds.length) return { counts: {} };
  const counts = {};
  const countRows = await queryMany(
    `SELECT placement_drive_id, COUNT(*)::int AS cnt
     FROM student_placement_process WHERE placement_drive_id = ANY($1::bigint[])
     GROUP BY placement_drive_id`,
    [driveIds]
  );
  countRows.forEach((r) => {
    counts[r.placement_drive_id] = r.cnt;
  });
  return { counts };
}

/** Distinct school–program pairs per drive (from registered students). */
async function getSchoolProgramPairsByDriveIds(driveIds) {
  if (!driveIds.length) return {};
  const rows = await queryMany(
    `SELECT spp.placement_drive_id AS drive_id, sch.name AS school, prg.name AS program
     FROM student_placement_process spp
     INNER JOIN student_basic_details sbd ON sbd.usn = spp.usn
     INNER JOIN schools sch ON sch.id = sbd.school_id
     INNER JOIN programs prg ON prg.id = sbd.program_id AND prg.school_id = sbd.school_id
     WHERE spp.placement_drive_id = ANY($1::bigint[])
       AND sbd.school_id IS NOT NULL AND sbd.program_id IS NOT NULL
     GROUP BY spp.placement_drive_id, sch.name, prg.name
     ORDER BY sch.name, prg.name`,
    [driveIds]
  );
  return rows.reduce((acc, r) => {
    if (!acc[r.drive_id]) acc[r.drive_id] = [];
    acc[r.drive_id].push({ school: r.school, program: r.program });
    return acc;
  }, {});
}

async function getStudentSchoolProgramMap(usns) {
  if (!usns.length) return {};
  const rows = await forEachChunk(usns, (chunk) =>
    queryMany('SELECT usn, school_id, program_id FROM student_basic_details WHERE usn = ANY($1::text[])', [
      chunk,
    ])
  );
  return rows.reduce((acc, s) => {
    acc[s.usn] = { school_id: s.school_id, program_id: s.program_id };
    return acc;
  }, {});
}

async function syncDriveStatusesRows() {
  return queryMany(
    'SELECT id, placement_status, last_date_to_registration, event_datetime FROM placements_drives'
  );
}

async function updateDriveStatus(id, status) {
  await pool.query(
    'UPDATE placements_drives SET placement_status = $2, updated_at = NOW() WHERE id = $1',
    [id, status]
  );
}

async function getAllProcessListRows() {
  const { rows } = await pool.query(
    `SELECT spp.*,
            pd.id AS drive_id, pd.job_type, pd.type_of_hiring, pd.event_datetime, pd.placement_status, pd.process_rounds,
            c.company_name,
            sbd.full_name AS student_full_name
     FROM student_placement_process spp
     LEFT JOIN placements_drives pd ON pd.id = spp.placement_drive_id
     LEFT JOIN companies c ON c.id = pd.company_id
     LEFT JOIN student_basic_details sbd ON sbd.usn = spp.usn
     ORDER BY spp.created_at DESC NULLS LAST`
  );
  return rows;
}

async function getStudentApplications(usn) {
  const { rows } = await pool.query(
    `SELECT spp.*, row_to_json(pd.*) AS drive
     FROM student_placement_process spp
     LEFT JOIN LATERAL (
       SELECT d.*, row_to_json(c.*) AS company
       FROM placements_drives d
       LEFT JOIN companies c ON c.id = d.company_id
       WHERE d.id = spp.placement_drive_id
     ) pd ON true
     WHERE spp.usn = $1
     ORDER BY spp.created_at DESC NULLS LAST`,
    [usn]
  );
  return rows.map((row) => {
    const drive = row.drive;
    const company = drive?.company;
    return {
      ...row,
      drive: drive ? { ...drive, company: company || {} } : {},
      company: company || {},
    };
  });
}

async function getStudentPlacements(usn) {
  return queryMany(
    `SELECT p.id, p.student_id, p.company_id, p.designation, p.offer_letter_status,
            p.ctc_min_lpa, p.ctc_max_lpa, p.type_of_hiring, p.academic_year, p.remarks,
            c.company_name
     FROM placement p
     LEFT JOIN companies c ON c.id = p.company_id
     WHERE p.student_id = $1
     ORDER BY p.created_at DESC NULLS LAST`,
    [usn]
  );
}

async function getOffersByStudentAndPlacements(usn, placementIds) {
  if (!placementIds.length) return [];
  return queryMany(
    'SELECT id, placement_id, is_accepted, remarks FROM offers WHERE student_id = $1 AND placement_id = ANY($2::bigint[])',
    [usn, placementIds]
  );
}

async function getOfferWithPlacement(offerId) {
  return queryOne(
    `SELECT o.*,
            row_to_json(p.*) AS placement,
            c.company_name AS placement_company_name
     FROM offers o
     LEFT JOIN placement p ON p.id = o.placement_id
     LEFT JOIN companies c ON c.id = p.company_id
     WHERE o.id = $1`,
    [offerId]
  );
}

async function getOfferByPlacementId(placementId) {
  return queryOne(
    `SELECT o.*,
            row_to_json(p.*) AS placement,
            c.company_name AS placement_company_name
     FROM offers o
     INNER JOIN placement p ON p.id = o.placement_id
     LEFT JOIN companies c ON c.id = p.company_id
     WHERE o.placement_id = $1`,
    [placementId]
  );
}

async function getPlacementById(placementId) {
  return queryOne(
    `SELECT p.*, c.company_name
     FROM placement p
     LEFT JOIN companies c ON c.id = p.company_id
     WHERE p.id = $1`,
    [placementId]
  );
}

async function updateOffer(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = [id, ...keys.map((k) => fields[k])];
  await pool.query(`UPDATE offers SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, values);
}

async function insertCapstone(row) {
  const cols = Object.keys(row);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO capstone (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING id`,
    cols.map((c) => row[c])
  );
  return rows[0];
}

async function deleteProcessByDriveAndUsn(driveId, usn) {
  const { rows } = await pool.query(
    `DELETE FROM student_placement_process WHERE placement_drive_id = $1 AND usn = $2 RETURNING id`,
    [driveId, usn]
  );
  return rows[0] ?? null;
}

async function updateProcessStatusById(id, fields) {
  return updateProcessById(id, fields);
}

async function getCompaniesList(schoolId = null) {
  const schoolsListRes = await pool.query(`
    SELECT sch.id, sch.name, COUNT(DISTINCT pd.company_id)::int AS count
    FROM student_placement_process spp
    INNER JOIN placements_drives pd ON pd.id = spp.placement_drive_id
    INNER JOIN student_basic_details sbd ON sbd.usn = spp.usn
    INNER JOIN schools sch ON sch.id = sbd.school_id
    WHERE pd.company_id IS NOT NULL AND sbd.school_id IS NOT NULL
    GROUP BY sch.id, sch.name
    HAVING COUNT(DISTINCT pd.company_id) > 0
    ORDER BY sch.name ASC
  `);
  const countRes = await pool.query('SELECT COUNT(*)::int AS total FROM companies');
  let companiesSql = `SELECT ${COMPANY_LIST_COLS} FROM companies`;
  const params = [];
  if (schoolId != null) {
    companiesSql = `
      SELECT DISTINCT ${COMPANY_LIST_COLS.split(', ').map((c) => `c.${c.trim()}`).join(', ')}
      FROM companies c
      INNER JOIN placements_drives pd ON pd.company_id = c.id
      INNER JOIN student_placement_process spp ON spp.placement_drive_id = pd.id
      INNER JOIN student_basic_details sbd ON sbd.usn = spp.usn AND sbd.school_id = $1
      ORDER BY c.company_name ASC`;
    params.push(schoolId);
  } else {
    companiesSql += ' ORDER BY company_name ASC';
  }
  const { rows: companies } = await pool.query(companiesSql, params);
  return {
    companies,
    schoolsList: schoolsListRes.rows,
    totalCompanies: countRes.rows[0]?.total ?? 0,
  };
}

async function getCompanyById(id) {
  return queryOne(`SELECT * FROM companies WHERE id = $1`, [id]);
}

async function getCompanyContacts(companyId) {
  return queryMany('SELECT * FROM contacts WHERE company_id = $1 ORDER BY id ASC', [companyId]);
}

async function insertCompany(payload) {
  const { rows } = await pool.query(
    `INSERT INTO companies (company_name, description, company_type, address, website, linkedin, remarks, company_logo_link)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      payload.company_name,
      payload.description,
      payload.company_type,
      payload.address,
      payload.website,
      payload.linkedin,
      payload.remarks,
      payload.company_logo_link,
    ]
  );
  return rows[0];
}

async function insertContacts(rows) {
  if (!rows.length) return;
  for (const r of rows) {
    await pool.query(
      `INSERT INTO contacts (company_id, contact_name, email, phone_number, role_title, remarks)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.company_id, r.contact_name, r.email, r.phone_number, r.role_title, r.remarks]
    );
  }
}

const COMPANY_UPDATE_COLS = new Set([
  'company_name',
  'description',
  'company_type',
  'address',
  'website',
  'linkedin',
  'remarks',
  'company_logo_link',
  'updated_at',
]);

function normalizeCompanyPayload(payload) {
  const safe = { ...payload };
  if (safe.industry != null && safe.company_type == null) {
    safe.company_type = safe.industry;
  }
  delete safe.industry;
  return Object.fromEntries(
    Object.entries(safe).filter(([k]) => COMPANY_UPDATE_COLS.has(k))
  );
}

async function updateCompany(id, payload) {
  const fields = normalizeCompanyPayload(payload);
  const keys = Object.keys(fields);
  if (!keys.length) return getCompanyById(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = [id, ...keys.map((k) => fields[k])];
  const { rows } = await pool.query(
    `UPDATE companies SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

async function deleteCompany(id) {
  await pool.query('DELETE FROM contacts WHERE company_id = $1', [id]);
  await pool.query('DELETE FROM companies WHERE id = $1', [id]);
}

const JOB_OFFERS_SELECT = `
      o.id,
      o.is_accepted,
      o.student_id,
      COALESCE(o.company_id, p.company_id) AS company_id,
      o.placement_id,
      o.capstone_id,
      o.job_type AS offer_job_type,
      o.academic_year AS offer_academic_year,
      o.remarks AS offer_remarks,
      o.created_at AS offer_created_at,
      o.updated_at AS offer_updated_at,
      p.designation AS placement_designation,
      p.offer_letter_status AS placement_offer_letter_status,
      p.job_description AS placement_job_description,
      p.ctc_min_lpa AS placement_ctc_min_lpa,
      p.ctc_max_lpa AS placement_ctc_max_lpa,
      p.ctc_variable_pay AS placement_ctc_variable_pay,
      p.ctc_stock_in_lpa AS placement_ctc_stock_in_lpa,
      p.type_of_hiring AS placement_type_of_hiring,
      p.academic_year AS placement_academic_year,
      p.remarks AS placement_remarks,
      cap.company_name AS capstone_company_name,
      cap.internship_duration_months AS capstone_internship_duration_months,
      cap.designation AS capstone_designation,
      cap.offer_letter_status AS capstone_offer_letter_status,
      cap.internship_stipend_min AS capstone_internship_stipend_min,
      cap.internship_stipend_max AS capstone_internship_stipend_max,
      cap.description AS capstone_description,
      cap.academic_year AS capstone_academic_year,
      cap.remarks AS capstone_remarks,
      sbd.usn,
      sbd.full_name AS student_name,
      sbd.year_of_joining AS batch,
      sch.name AS school,
      sch.abbreviation AS school_abbr,
      prg.name AS program,
      COALESCE(oc.company_name, pc.company_name, cap.company_name) AS company_name`;

const JOB_OFFERS_JOINS = `
    LEFT JOIN placement p ON p.id = o.placement_id
    LEFT JOIN capstone cap ON cap.id = o.capstone_id
    LEFT JOIN companies oc ON oc.id = o.company_id
    LEFT JOIN companies pc ON pc.id = p.company_id
    LEFT JOIN student_basic_details sbd ON sbd.usn = o.student_id
    LEFT JOIN schools sch ON sch.id = sbd.school_id
    LEFT JOIN programs prg ON prg.id = sbd.program_id`;

async function getAllJobOffersRows() {
  const { rows } = await pool.query(`
    SELECT ${JOB_OFFERS_SELECT}
    FROM offers o
    ${JOB_OFFERS_JOINS}
    ORDER BY o.created_at DESC NULLS LAST
  `);
  return rows;
}

/** All job offers for one company (offers rows + placements without an offers link). */
async function getCompanyJobOffersRows(companyId) {
  const { rows } = await pool.query(
    `
    SELECT * FROM (
      SELECT ${JOB_OFFERS_SELECT}, true AS from_offers_table
      FROM offers o
      ${JOB_OFFERS_JOINS}
      WHERE COALESCE(o.company_id, p.company_id) = $1

      UNION ALL

      SELECT
        NULL::bigint AS id,
        NULL::boolean AS is_accepted,
        p.student_id,
        p.company_id AS company_id,
        p.id AS placement_id,
        NULL::bigint AS capstone_id,
        p.type_of_hiring AS offer_job_type,
        p.academic_year AS offer_academic_year,
        p.remarks AS offer_remarks,
        p.created_at AS offer_created_at,
        p.updated_at AS offer_updated_at,
        p.designation AS placement_designation,
        p.offer_letter_status AS placement_offer_letter_status,
        p.job_description AS placement_job_description,
        p.ctc_min_lpa AS placement_ctc_min_lpa,
        p.ctc_max_lpa AS placement_ctc_max_lpa,
        p.ctc_variable_pay AS placement_ctc_variable_pay,
        p.ctc_stock_in_lpa AS placement_ctc_stock_in_lpa,
        p.type_of_hiring AS placement_type_of_hiring,
        p.academic_year AS placement_academic_year,
        p.remarks AS placement_remarks,
        NULL::text AS capstone_company_name,
        NULL::int AS capstone_internship_duration_months,
        NULL::text AS capstone_designation,
        NULL::text AS capstone_offer_letter_status,
        NULL::numeric AS capstone_internship_stipend_min,
        NULL::numeric AS capstone_internship_stipend_max,
        NULL::text AS capstone_description,
        NULL::text AS capstone_academic_year,
        NULL::text AS capstone_remarks,
        sbd.usn,
        sbd.full_name AS student_name,
        sbd.year_of_joining AS batch,
        sch.name AS school,
        sch.abbreviation AS school_abbr,
        prg.name AS program,
        c.company_name AS company_name,
        false AS from_offers_table
      FROM placement p
      LEFT JOIN offers o ON o.placement_id = p.id
      LEFT JOIN companies c ON c.id = p.company_id
      LEFT JOIN student_basic_details sbd ON sbd.usn = p.student_id
      LEFT JOIN schools sch ON sch.id = sbd.school_id
      LEFT JOIN programs prg ON prg.id = sbd.program_id
      WHERE p.company_id = $1 AND o.id IS NULL
    ) combined
    ORDER BY offer_created_at DESC NULLS LAST
    `,
    [companyId]
  );
  return rows;
}

async function getOverviewStatsForUsns(usns) {
  if (!usns.length) return { processes: [], offers: [], placements: [], capstones: [], violations: new Set(), disciplinary: new Set(), editLocks: new Map() };
  const [processes, offers, placements, capstones, violations, disciplinary, editLocks] = await Promise.all([
    forEachChunk(usns, (chunk) =>
      queryMany(
        `SELECT usn, placement_drive_id, is_eligible, registration_status, oa_status, gd_status,
                technical_round_status, interview_status, hr_round_status, final_select_status, attendance, malpractice
         FROM student_placement_process WHERE usn = ANY($1::text[])`,
        [chunk]
      )
    ),
    forEachChunk(usns, (chunk) =>
      queryMany(
        'SELECT student_id, placement_id, capstone_id, job_type, is_accepted FROM offers WHERE student_id = ANY($1::text[])',
        [chunk]
      )
    ),
    forEachChunk(usns, (chunk) =>
      queryMany('SELECT student_id, ctc_min_lpa, ctc_max_lpa FROM placement WHERE student_id = ANY($1::text[])', [chunk])
    ),
    forEachChunk(usns, (chunk) =>
      queryMany(
        'SELECT usn, internship_stipend_min, internship_stipend_max FROM capstone WHERE usn = ANY($1::text[])',
        [chunk]
      )
    ),
    forEachChunk(usns, (chunk) =>
      queryMany('SELECT usn FROM student_placement_violations WHERE usn = ANY($1::text[]) AND is_active = true', [chunk])
    ),
    forEachChunk(usns, (chunk) =>
      queryMany('SELECT usn FROM student_disciplinary_records WHERE usn = ANY($1::text[]) AND is_active = true', [chunk])
    ),
    forEachChunk(usns, (chunk) =>
      queryMany('SELECT usn, is_placements_locked FROM student_edit_control WHERE usn = ANY($1::text[])', [chunk])
    ),
  ]);
  return {
    processes,
    offers,
    placements,
    capstones,
    violations: new Set(violations.map((v) => v.usn)),
    disciplinary: new Set(disciplinary.map((d) => d.usn)),
    editLocks: new Map(editLocks.map((e) => [e.usn, e.is_placements_locked])),
  };
}

async function getExportProcessRows(driveId) {
  return queryMany(
    'SELECT * FROM student_placement_process WHERE placement_drive_id = $1 ORDER BY created_at DESC NULLS LAST',
    [driveId]
  );
}

async function getStudentsBasicByUsns(usns) {
  if (!usns.length) return [];
  return forEachChunk(usns, (chunk) =>
    queryMany(
      `SELECT usn, full_name, college_email, personal_email, phone_country_code, phone_number,
              year_of_joining, current_year, current_semester, section, gender,
              school_id, program_id, major_id, specialization_id
       FROM student_basic_details WHERE usn = ANY($1::text[])`,
      [chunk]
    )
  );
}

async function getProfilesByUsns(usns) {
  if (!usns.length) return [];
  return forEachChunk(usns, (chunk) =>
    queryMany(
      'SELECT usn, resume_file, brief_summary, key_expertise, career_objective FROM student_profile_details WHERE usn = ANY($1::text[])',
      [chunk]
    )
  );
}

async function getEducationByUsns(usns) {
  if (!usns.length) return [];
  return forEachChunk(usns, (chunk) =>
    queryMany(
      'SELECT usn, education_level, institute_name, end_year FROM student_education_history WHERE usn = ANY($1::text[])',
      [chunk]
    )
  );
}

async function getInternshipsByUsns(usns) {
  if (!usns.length) return [];
  return forEachChunk(usns, (chunk) =>
    queryMany(
      'SELECT usn, job_role, organization, duration_months FROM student_internships WHERE usn = ANY($1::text[])',
      [chunk]
    )
  );
}

async function getEducationHistoryByUsns(usns) {
  if (!usns.length) return [];
  return forEachChunk(usns, (chunk) =>
    queryMany(
      `SELECT usn, education_level, institute_name, end_year, result, result_type
       FROM student_education_history WHERE usn = ANY($1::text[])`,
      [chunk]
    )
  );
}

async function getAcademicsByUsns(usns) {
  if (!usns.length) return [];
  const { rows: meta } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'student_semester_records'
     ) AS has_records`
  );
  const table = meta[0]?.has_records ? 'student_semester_records' : 'student_semester_academics';
  const useRecords = table === 'student_semester_records';
  const sgpaCol = useRecords ? 'COALESCE(cgpa, sgpa)' : 'result_in_sgpa';
  const liveBacklogsCol = useRecords ? 'COALESCE(active_backlogs, 0)' : 'COALESCE(live_backlogs, 0)';
  const closedBacklogsCol = useRecords ? 'COALESCE(cleared_backlogs, 0)' : 'COALESCE(closed_backlogs, 0)';
  return forEachChunk(usns, (chunk) =>
    queryMany(
      `SELECT usn, academic_year, semester, ${sgpaCol} AS result_in_sgpa,
              ${liveBacklogsCol} AS live_backlogs, ${closedBacklogsCol} AS closed_backlogs
       FROM ${table} WHERE usn = ANY($1::text[])
       ORDER BY academic_year DESC NULLS LAST, semester DESC NULLS LAST`,
      [chunk]
    )
  );
}

async function insertPlacementDrive(row) {
  const { rows } = await pool.query(
    `INSERT INTO placements_drives (
       company_id, academic_year, year, job_type, type_of_hiring, job_description, job_location,
       ctc_structure, stipend_structure, process_rounds, number_of_openings, number_of_registrations,
       placement_status, last_date_to_registration, event_datetime, onboarded_date, tpo, company_remarks
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      row.company_id,
      row.academic_year,
      row.year,
      row.job_type,
      row.type_of_hiring,
      row.job_description,
      row.job_location,
      row.ctc_structure ? JSON.stringify(row.ctc_structure) : null,
      row.stipend_structure ? JSON.stringify(row.stipend_structure) : null,
      row.process_rounds ? JSON.stringify(row.process_rounds) : null,
      row.number_of_openings,
      row.number_of_registrations,
      row.placement_status,
      row.last_date_to_registration,
      row.event_datetime,
      row.onboarded_date,
      row.tpo,
      row.company_remarks,
    ]
  );
  return rows[0];
}

async function updatePlacementDrive(id, row) {
  const { rows } = await pool.query(
    `UPDATE placements_drives SET
       company_id = $2, academic_year = $3, year = $4, job_type = $5, type_of_hiring = $6,
       job_description = $7, job_location = $8, ctc_structure = $9::jsonb, stipend_structure = $10::jsonb,
       process_rounds = $11::jsonb, number_of_openings = $12, number_of_registrations = $13,
       placement_status = $14, last_date_to_registration = $15, event_datetime = $16,
       onboarded_date = $17, tpo = $18, company_remarks = $19, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [
      id,
      row.company_id,
      row.academic_year,
      row.year,
      row.job_type,
      row.type_of_hiring,
      row.job_description,
      row.job_location,
      row.ctc_structure ? JSON.stringify(row.ctc_structure) : null,
      row.stipend_structure ? JSON.stringify(row.stipend_structure) : null,
      row.process_rounds ? JSON.stringify(row.process_rounds) : null,
      row.number_of_openings,
      row.number_of_registrations,
      row.placement_status,
      row.last_date_to_registration,
      row.event_datetime,
      row.onboarded_date,
      row.tpo,
      row.company_remarks,
    ]
  );
  return rows[0] ?? null;
}

async function patchPlacementDrive(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = [id, ...keys.map((k) => fields[k])];
  const { rows } = await pool.query(
    `UPDATE placements_drives SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

async function getCompanyDrives(companyId) {
  return queryMany(
    'SELECT * FROM placements_drives WHERE company_id = $1 ORDER BY created_at DESC NULLS LAST',
    [companyId]
  );
}

async function getCompanyPlacements(companyId) {
  return queryMany(
    `SELECT p.id, p.student_id, p.designation, p.offer_letter_status, p.ctc_min_lpa, p.ctc_max_lpa,
            p.type_of_hiring, p.academic_year, sbd.full_name, sch.name AS school_name
     FROM placement p
     LEFT JOIN student_basic_details sbd ON sbd.usn = p.student_id
     LEFT JOIN schools sch ON sch.id = sbd.school_id
     WHERE p.company_id = $1
     ORDER BY p.created_at DESC NULLS LAST`,
    [companyId]
  );
}

async function insertContacts(rows) {
  if (!rows.length) return [];
  const inserted = [];
  for (const r of rows) {
    const { rows: res } = await pool.query(
      `INSERT INTO contacts (company_id, contact_name, email, phone_number, role_title, remarks)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [r.company_id, r.contact_name, r.email, r.phone_number, r.role_title, r.remarks]
    );
    if (res[0]) inserted.push(res[0]);
  }
  return inserted;
}

async function updateContact(contactId, companyId, payload) {
  const keys = Object.keys(payload);
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  const values = [contactId, companyId, ...keys.map((k) => payload[k])];
  const { rows } = await pool.query(
    `UPDATE contacts SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

async function deleteContact(contactId, companyId) {
  await pool.query('DELETE FROM contacts WHERE id = $1 AND company_id = $2', [contactId, companyId]);
}

async function fetchOverviewStudentsPage({ limit, offset, search, schoolIds, programIds }) {
  const params = [];
  const where = ['s.opt_in = true'];
  let idx = 1;
  if (search) {
    where.push(`(s.usn ILIKE $${idx} OR s.full_name ILIKE $${idx} OR s.college_email ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx += 1;
  }
  if (schoolIds?.length) {
    where.push(`s.school_id = ANY($${idx}::int[])`);
    params.push(schoolIds);
    idx += 1;
  }
  if (programIds?.length) {
    where.push(`s.program_id = ANY($${idx}::int[])`);
    params.push(programIds);
    idx += 1;
  }
  const whereClause = where.join(' AND ');
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM student_basic_details s WHERE ${whereClause}`,
    params
  );
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT s.usn, s.full_name, s.college_email, s.school_id, s.program_id,
            sch.name AS school_name, prg.name AS program_name
     FROM student_basic_details s
     LEFT JOIN schools sch ON sch.id = s.school_id
     LEFT JOIN programs prg ON prg.id = s.program_id
     WHERE ${whereClause}
     ORDER BY s.usn ASC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );
  return { students: rows, total: countRes.rows[0]?.total ?? 0 };
}

async function getPlacementOverviewData() {
  const [students, schools, programs, policies, placementRows, placementYears] = await Promise.all([
    queryMany('SELECT usn, school_id, program_id, year_of_joining, current_year FROM student_basic_details'),
    queryMany('SELECT id, name FROM schools'),
    queryMany('SELECT id, school_id, name, graduation_level FROM programs'),
    queryMany(
      'SELECT school_id, program_id, joining_year, summer_immersion, summer_internship, capstone, placement FROM batch_academic_policies'
    ),
    queryMany('SELECT student_id, ctc_min_lpa, ctc_max_lpa, academic_year FROM placement'),
    queryMany('SELECT DISTINCT academic_year FROM placement WHERE academic_year IS NOT NULL'),
  ]);
  return { students, schools, programs, policies, placementRows, placementYears };
}

async function getStudentBasicByUsn(usn) {
  return queryOne('SELECT usn, full_name FROM student_basic_details WHERE usn = $1', [usn]);
}

async function insertPlacement(row) {
  const cols = Object.keys(row);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO placement (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`,
    cols.map((c) => row[c])
  );
  return rows[0];
}

async function insertOffer(row) {
  const cols = Object.keys(row);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO offers (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`,
    cols.map((c) => row[c])
  );
  return rows[0];
}

async function getOfferById(id) {
  return queryOne('SELECT * FROM offers WHERE id = $1', [id]);
}

async function updatePlacement(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = [id, ...keys.map((k) => fields[k])];
  await pool.query(`UPDATE placement SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, values);
}

async function updateCapstone(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const values = [id, ...keys.map((k) => fields[k])];
  await pool.query(`UPDATE capstone SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, values);
}

async function countOptedInStudents() {
  const row = await queryOne('SELECT COUNT(*)::int AS cnt FROM student_basic_details WHERE opt_in = true');
  return row?.cnt ?? 0;
}

async function countOffers() {
  const row = await queryOne('SELECT COUNT(*)::int AS cnt FROM offers');
  return row?.cnt ?? 0;
}

async function getOffersForDashboard() {
  return queryMany('SELECT student_id, placement_id, capstone_id FROM offers');
}

async function getEventsByIds(ids) {
  if (!ids.length) return [];
  return queryMany(
    'SELECT * FROM events WHERE id = ANY($1::bigint[]) ORDER BY event_datetime ASC NULLS LAST',
    [ids]
  );
}

async function getAllEventsOrdered() {
  return queryMany('SELECT * FROM events ORDER BY event_datetime ASC NULLS LAST');
}

module.exports = {
  getDriveForNotification,
  getStudentOptIn,
  getStudentForApply,
  getProcessByDriveAndUsn,
  updateProcessById,
  insertProcess,
  getDriveEligibilityCriteria,
  updateDriveEligibilityCriteria,
  getExistingProcessUsns,
  insertProcessBatch,
  fetchAllDrivesRows,
  getRegistrationCountsByDrive,
  getSchoolProgramPairsByDriveIds,
  getStudentSchoolProgramMap,
  syncDriveStatusesRows,
  updateDriveStatus,
  getAllProcessListRows,
  getStudentApplications,
  getStudentPlacements,
  getOffersByStudentAndPlacements,
  getOfferWithPlacement,
  updateOffer,
  insertCapstone,
  deleteProcessByDriveAndUsn,
  updateProcessStatusById,
  getCompaniesList,
  getCompanyById,
  getCompanyContacts,
  insertCompany,
  insertContacts,
  updateCompany,
  deleteCompany,
  getAllJobOffersRows,
  getCompanyJobOffersRows,
  getOfferByPlacementId,
  getPlacementById,
  getOverviewStatsForUsns,
  getExportProcessRows,
  getStudentsBasicByUsns,
  getProfilesByUsns,
  getEducationByUsns,
  getInternshipsByUsns,
  getEducationHistoryByUsns,
  getAcademicsByUsns,
  insertPlacementDrive,
  updatePlacementDrive,
  patchPlacementDrive,
  getCompanyDrives,
  getCompanyPlacements,
  insertContacts,
  updateContact,
  deleteContact,
  fetchOverviewStudentsPage,
  getPlacementOverviewData,
  getStudentBasicByUsn,
  insertPlacement,
  insertOffer,
  getOfferById,
  updatePlacement,
  updateCapstone,
  countOptedInStudents,
  countOffers,
  getOffersForDashboard,
  getEventsByIds,
  getAllEventsOrdered,
  catalogDb,
};
