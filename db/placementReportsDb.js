const { pool, queryMany, queryOne } = require('./query');

function dateFilterClause(dateCol, fromTs, toTs, paramStart = 1) {
  const parts = [];
  const params = [];
  let idx = paramStart;
  if (fromTs) {
    parts.push(`${dateCol} >= $${idx}`);
    params.push(fromTs);
    idx += 1;
  }
  if (toTs) {
    parts.push(`${dateCol} <= $${idx}`);
    params.push(toTs);
    idx += 1;
  }
  return { clause: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

async function fetchReportData(fromTs, toTs) {
  const pf = (col, start = 1) => dateFilterClause(col, fromTs, toTs, start);

  const placementsF = pf('p.created_at');
  const offersF = pf('o.created_at');
  const drivesF = pf('pd.created_at');
  const companiesF = pf('c.created_at');
  const processF = pf('spp.created_at');
  const logsF = pf('edl.evaluated_at');
  const violationsF = pf('v.created_at');
  const disciplinaryF = pf('d.created_at');
  const eventsF = pf('e.created_at');
  const hrF = pf('hr.created_at');

  const [
    placements,
    offers,
    drives,
    companies,
    students,
    processRows,
    eligibilityLogs,
    violations,
    disciplinary,
    events,
    hrRecs,
    schools,
    programs,
    totalPlacedRow,
    studentProfiles,
    studentInterns,
    studentProjs,
    studentCerts,
  ] = await Promise.all([
    queryMany(
      `SELECT p.*, c.company_name
       FROM placement p
       LEFT JOIN companies c ON c.id = p.company_id
       WHERE 1=1${placementsF.clause}
       ORDER BY p.created_at DESC NULLS LAST`,
      placementsF.params
    ),
    queryMany(
      `SELECT o.*, c.company_name
       FROM offers o
       LEFT JOIN companies c ON c.id = o.company_id
       WHERE 1=1${offersF.clause}
       ORDER BY o.created_at DESC NULLS LAST`,
      offersF.params
    ),
    queryMany(
      `SELECT pd.*, c.company_name
       FROM placements_drives pd
       LEFT JOIN companies c ON c.id = pd.company_id
       WHERE 1=1${drivesF.clause}
       ORDER BY pd.created_at DESC NULLS LAST`,
      drivesF.params
    ),
    queryMany(
      `SELECT * FROM companies c WHERE 1=1${companiesF.clause}`,
      companiesF.params
    ),
    queryMany(
      `SELECT usn, full_name, school_id, program_id, year_of_joining, opt_in,
              is_placement_eligible, is_summer_internship_eligible
       FROM student_basic_details`
    ),
    queryMany(
      `SELECT * FROM student_placement_process spp WHERE 1=1${processF.clause}`,
      processF.params
    ),
    queryMany(
      `SELECT * FROM eligibility_decision_logs edl WHERE 1=1${logsF.clause}`,
      logsF.params
    ),
    queryMany(
      `SELECT * FROM student_placement_violations v WHERE 1=1${violationsF.clause}`,
      violationsF.params
    ),
    queryMany(
      `SELECT * FROM student_disciplinary_records d WHERE 1=1${disciplinaryF.clause}`,
      disciplinaryF.params
    ),
    queryMany(
      `SELECT * FROM events e WHERE 1=1${eventsF.clause}`,
      eventsF.params
    ),
    queryMany(
      `SELECT * FROM hr_recommendations hr WHERE 1=1${hrF.clause}`,
      hrF.params
    ),
    queryMany('SELECT id, name FROM schools'),
    queryMany('SELECT id, name, graduation_level FROM programs'),
    queryOne('SELECT COUNT(*)::int AS cnt FROM placement'),
    queryMany('SELECT usn, resume_file FROM student_profile_details WHERE resume_file IS NOT NULL'),
    queryMany('SELECT DISTINCT usn FROM student_internships'),
    queryMany('SELECT DISTINCT owner_usn AS usn FROM projects WHERE owner_usn IS NOT NULL'),
    queryMany('SELECT DISTINCT usn FROM student_certifications'),
  ]);

  const driveIds = [...new Set(processRows.map((p) => p.placement_drive_id).filter(Boolean))];
  let drivesForProcess = [];
  if (driveIds.length) {
    const { rows } = await pool.query(
      `SELECT pd.id, c.company_name
       FROM placements_drives pd
       LEFT JOIN companies c ON c.id = pd.company_id
       WHERE pd.id = ANY($1::bigint[])`,
      [driveIds]
    );
    drivesForProcess = rows;
  }

  const placementUsns = [...new Set(placements.map((p) => p.student_id).filter(Boolean))];
  let studentNames = [];
  if (placementUsns.length) {
    const { rows } = await pool.query(
      'SELECT usn, full_name FROM student_basic_details WHERE usn = ANY($1::text[])',
      [placementUsns]
    );
    studentNames = rows;
  }

  return {
    placements,
    offers,
    drives,
    companies,
    students,
    processRows,
    eligibilityLogs,
    violations,
    disciplinary,
    events,
    hrRecs,
    schools,
    programs,
    totalPlaced: totalPlacedRow?.cnt ?? 0,
    drivesForProcess,
    studentNames,
    studentProfiles,
    studentInterns,
    studentProjs,
    studentCerts,
  };
}

module.exports = { fetchReportData };
