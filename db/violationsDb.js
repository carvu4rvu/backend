const { queryMany, queryOne, pool, chunkArray } = require('./query');

async function getEligibilityDecisionLogs() {
  return queryMany(
    `SELECT edl.*,
            pd.id AS drive_id_ref,
            pd.job_type AS drive_job_type,
            pd.placement_status AS drive_placement_status,
            c.id AS company_id,
            c.company_name
     FROM eligibility_decision_logs edl
     LEFT JOIN placements_drives pd ON pd.id = edl.placement_drive_id
     LEFT JOIN companies c ON c.id = pd.company_id
     ORDER BY edl.evaluated_at DESC NULLS LAST`
  );
}

async function getPlacementViolations() {
  return queryMany(
    `SELECT spv.*,
            pd.id AS drive_id_ref,
            pd.job_type AS drive_job_type,
            c.id AS company_id,
            c.company_name
     FROM student_placement_violations spv
     LEFT JOIN placements_drives pd ON pd.id = spv.placement_drive_id
     LEFT JOIN companies c ON c.id = pd.company_id
     ORDER BY spv.created_at DESC NULLS LAST`
  );
}

async function getDisciplinaryRecords() {
  return queryMany(
    'SELECT * FROM student_disciplinary_records ORDER BY created_at DESC NULLS LAST'
  );
}

async function insertPlacementViolation(payload) {
  const cols = Object.keys(payload);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO student_placement_violations (${cols.join(', ')})
     VALUES (${vals.join(', ')}) RETURNING *`,
    cols.map((c) => payload[c])
  );
  return rows[0];
}

async function insertEligibilityDecisionLog(payload) {
  const cols = Object.keys(payload);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO eligibility_decision_logs (${cols.join(', ')})
     VALUES (${vals.join(', ')}) RETURNING *`,
    cols.map((c) => payload[c])
  );
  return rows[0];
}

async function insertDisciplinaryRecord(payload) {
  const cols = Object.keys(payload);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO student_disciplinary_records (${cols.join(', ')})
     VALUES (${vals.join(', ')}) RETURNING *`,
    cols.map((c) => payload[c])
  );
  return rows[0];
}

async function updateRowById(table, id, payload) {
  const cols = Object.keys(payload);
  if (!cols.length) return null;
  const sets = cols.map((c, i) => `${c} = $${i + 2}`);
  const { rows } = await pool.query(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...cols.map((c) => payload[c])]
  );
  return rows[0] || null;
}

async function deleteRowById(table, id) {
  const { rowCount } = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  return rowCount > 0;
}

async function getEligibilityDecisionLogById(id) {
  const rows = await queryMany(
    `SELECT edl.*,
            pd.id AS drive_id_ref,
            pd.job_type AS drive_job_type,
            pd.placement_status AS drive_placement_status,
            c.id AS company_id,
            c.company_name
     FROM eligibility_decision_logs edl
     LEFT JOIN placements_drives pd ON pd.id = edl.placement_drive_id
     LEFT JOIN companies c ON c.id = pd.company_id
     WHERE edl.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getPlacementViolationById(id) {
  const rows = await queryMany(
    `SELECT spv.*,
            pd.id AS drive_id_ref,
            pd.job_type AS drive_job_type,
            c.id AS company_id,
            c.company_name
     FROM student_placement_violations spv
     LEFT JOIN placements_drives pd ON pd.id = spv.placement_drive_id
     LEFT JOIN companies c ON c.id = pd.company_id
     WHERE spv.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function getDisciplinaryRecordById(id) {
  const rows = await queryMany('SELECT * FROM student_disciplinary_records WHERE id = $1', [id]);
  return rows[0] || null;
}

async function updateEligibilityDecisionLog(id, payload) {
  return updateRowById('eligibility_decision_logs', id, payload);
}

async function deleteEligibilityDecisionLog(id) {
  return deleteRowById('eligibility_decision_logs', id);
}

async function updatePlacementViolation(id, payload) {
  return updateRowById('student_placement_violations', id, payload);
}

async function deletePlacementViolation(id) {
  return deleteRowById('student_placement_violations', id);
}

async function updateDisciplinaryRecord(id, payload) {
  return updateRowById('student_disciplinary_records', id, payload);
}

async function deleteDisciplinaryRecord(id) {
  return deleteRowById('student_disciplinary_records', id);
}

function shapeLogRow(row) {
  return {
    ...row,
    drive: row.placement_drive_id
      ? {
          id: row.drive_id_ref || row.placement_drive_id,
          job_type: row.drive_job_type,
          placement_status: row.drive_placement_status,
          company: row.company_id
            ? { id: row.company_id, company_name: row.company_name }
            : null,
        }
      : null,
  };
}

function shapeViolationRow(row) {
  return {
    ...row,
    drive: row.placement_drive_id
      ? {
          id: row.drive_id_ref || row.placement_drive_id,
          job_type: row.drive_job_type,
          company: row.company_id
            ? { id: row.company_id, company_name: row.company_name }
            : null,
        }
      : null,
  };
}

/**
 * Load active violations scoped to a placement drive (or global policy rows with null drive_id).
 * Disciplinary records are student-wide (not drive-scoped).
 */
async function getDriveComplianceMaps(usns, driveId) {
  const violationsByUsn = {};
  const disciplinaryByUsn = {};
  if (!usns?.length) return { violationsByUsn, disciplinaryByUsn };

  usns.forEach((u) => {
    violationsByUsn[u] = [];
    disciplinaryByUsn[u] = [];
  });

  const driveIdNum = driveId != null ? parseInt(driveId, 10) : null;

  for (const chunk of chunkArray(usns, 400)) {
    const violParams = [chunk];
    let violSql = `
      SELECT usn, placement_drive_id, violation_type, penalty_type, penalty_days, remarks, created_at
      FROM student_placement_violations
      WHERE usn = ANY($1::text[]) AND is_active = true`;
    if (driveIdNum != null && !Number.isNaN(driveIdNum)) {
      violSql += ` AND (placement_drive_id = $2 OR placement_drive_id IS NULL)`;
      violParams.push(driveIdNum);
    }
    const [violRes, discRes] = await Promise.all([
      pool.query(violSql, violParams),
      pool.query(
        `SELECT usn, violation_type, severity, description, start_date, end_date, created_at
         FROM student_disciplinary_records
         WHERE usn = ANY($1::text[]) AND is_active = true`,
        [chunk]
      ),
    ]);
    (violRes.rows || []).forEach((v) => {
      if (violationsByUsn[v.usn]) violationsByUsn[v.usn].push(v);
    });
    (discRes.rows || []).forEach((d) => {
      if (disciplinaryByUsn[d.usn]) disciplinaryByUsn[d.usn].push(d);
    });
  }

  return { violationsByUsn, disciplinaryByUsn };
}

module.exports = {
  getEligibilityDecisionLogs,
  getPlacementViolations,
  getDisciplinaryRecords,
  getDriveComplianceMaps,
  insertPlacementViolation,
  insertEligibilityDecisionLog,
  insertDisciplinaryRecord,
  getEligibilityDecisionLogById,
  getPlacementViolationById,
  getDisciplinaryRecordById,
  updateEligibilityDecisionLog,
  deleteEligibilityDecisionLog,
  updatePlacementViolation,
  deletePlacementViolation,
  updateDisciplinaryRecord,
  deleteDisciplinaryRecord,
  shapeLogRow,
  shapeViolationRow,
};
