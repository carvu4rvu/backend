const supabase = require('../config/supabaseClient');
const pool = require('../config/db');
const logger = require('../utils/logger');

function apiMessage(err, fallback = 'Server error') {
  if (!err) return fallback;
  if (typeof err.message === 'string' && err.message.trim()) return err.message.trim();
  if (err.error_description) return String(err.error_description);
  if (err.details) return String(err.details);
  return fallback;
}

/** GET eligibility_decision_logs with drive and company info */
exports.getEligibilityDecisionLogs = async (req, res) => {
  try {
    const query = `
      SELECT 
        edl.*,
        pd.id as pd_id,
        pd.job_type as pd_job_type,
        pd.placement_status as pd_placement_status,
        c.id as c_id,
        c.company_name as c_company_name
      FROM eligibility_decision_logs edl
      LEFT JOIN placements_drives pd ON edl.placement_drive_id = pd.id
      LEFT JOIN companies c ON pd.company_id = c.id
      ORDER BY edl.evaluated_at DESC
    `;
    const { rows } = await pool.query(query);
    
    const formatted = rows.map(row => ({
      ...row,
      drive: row.pd_id ? {
        id: row.pd_id,
        job_type: row.pd_job_type,
        placement_status: row.pd_placement_status,
        company: row.c_id ? {
          id: row.c_id,
          company_name: row.c_company_name
        } : null
      } : null
    }));

    res.json(formatted);
  } catch (err) {
    logger.error('getEligibilityDecisionLogs:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** GET student_placement_violations with drive info */
exports.getPlacementViolations = async (req, res) => {
  try {
    const query = `
      SELECT 
        spv.*,
        pd.id as pd_id,
        pd.job_type as pd_job_type,
        c.id as c_id,
        c.company_name as c_company_name
      FROM student_placement_violations spv
      LEFT JOIN placements_drives pd ON spv.placement_drive_id = pd.id
      LEFT JOIN companies c ON pd.company_id = c.id
      ORDER BY spv.created_at DESC
    `;
    const { rows } = await pool.query(query);

    const formatted = rows.map(row => ({
      ...row,
      drive: row.pd_id ? {
        id: row.pd_id,
        job_type: row.pd_job_type,
        company: row.c_id ? {
          id: row.c_id,
          company_name: row.c_company_name
        } : null
      } : null
    }));

    res.json(formatted);
  } catch (err) {
    logger.error('getPlacementViolations:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** GET student_disciplinary_records */
exports.getDisciplinaryRecords = async (req, res) => {
  try {
    const query = 'SELECT * FROM student_disciplinary_records ORDER BY created_at DESC';
    const { rows } = await pool.query(query);
    res.json(rows || []);
  } catch (err) {
    logger.error('getDisciplinaryRecords:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** POST student_placement_violations */
exports.createPlacementViolation = async (req, res) => {
  try {
    const { usn, placement_drive_id, violation_type, penalty_type, penalty_days, remarks } = req.body;
    if (!usn || !violation_type || !penalty_type) {
      return res.status(400).json({ message: 'usn, violation_type, and penalty_type are required' });
    }
    const validPenalties = ['WARNING', 'TEMP_BAN', 'PERMANENT_BAN'];
    if (!validPenalties.includes(penalty_type)) {
      return res.status(400).json({ message: 'penalty_type must be WARNING, TEMP_BAN, or PERMANENT_BAN' });
    }
    
    const driveId = (placement_drive_id != null && placement_drive_id !== '') ? parseInt(placement_drive_id, 10) : null;
    const pDays = (penalty_type === 'TEMP_BAN' && penalty_days != null && penalty_days !== '') ? parseInt(penalty_days, 10) : null;

    const query = `
      INSERT INTO student_placement_violations (
        usn, placement_drive_id, violation_type, penalty_type, penalty_days, remarks, is_active, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [
      String(usn).trim(),
      driveId,
      String(violation_type).trim(),
      penalty_type,
      pDays,
      remarks ? String(remarks).trim() : null,
      true,
      req.user?.id || null
    ];

    const { rows } = await pool.query(query, values);
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('createPlacementViolation:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** POST eligibility_decision_logs */
exports.createEligibilityDecisionLog = async (req, res) => {
  try {
    const { usn, placement_drive_id, is_eligible, rejection_reasons, evaluated_by } = req.body;
    if (!usn || !placement_drive_id || is_eligible === undefined) {
      return res.status(400).json({ message: 'usn, placement_drive_id, and is_eligible are required' });
    }

    const query = `
      INSERT INTO eligibility_decision_logs (
        usn, placement_drive_id, is_eligible, rejection_reasons, evaluated_by, evaluated_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [
      String(usn).trim(),
      parseInt(placement_drive_id, 10),
      Boolean(is_eligible),
      Array.isArray(rejection_reasons) ? rejection_reasons : (rejection_reasons ? [rejection_reasons] : null),
      evaluated_by ? String(evaluated_by).trim() : (req.user?.email || 'ADMIN'),
      new Date().toISOString()
    ];

    const { rows } = await pool.query(query, values);
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('createEligibilityDecisionLog:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** POST student_disciplinary_records */
exports.createDisciplinaryRecord = async (req, res) => {
  try {
    const { usn, violation_type, severity, description, start_date, end_date } = req.body;
    if (!usn || !violation_type || !severity || !start_date) {
      return res.status(400).json({ message: 'usn, violation_type, severity, and start_date are required' });
    }
    const validSeverities = ['MINOR', 'MAJOR', 'CRITICAL'];
    if (!validSeverities.includes(severity)) {
      return res.status(400).json({ message: 'severity must be MINOR, MAJOR, or CRITICAL' });
    }

    const query = `
      INSERT INTO student_disciplinary_records (
        usn, violation_type, severity, description, is_active, start_date, end_date, reported_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [
      String(usn).trim(),
      String(violation_type).trim(),
      severity,
      description ? String(description).trim() : null,
      true,
      String(start_date).trim(),
      end_date ? String(end_date).trim() : null,
      req.user?.id || null
    ];

    const { rows } = await pool.query(query, values);
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('createDisciplinaryRecord:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** PUT eligibility_decision_logs/:id */
exports.updateEligibilityDecisionLog = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_eligible, rejection_reasons, evaluated_by } = req.body;
    
    const query = `
      UPDATE eligibility_decision_logs 
      SET is_eligible = $1, rejection_reasons = $2, evaluated_by = $3
      WHERE id = $4
      RETURNING *
    `;
    const values = [
      Boolean(is_eligible),
      Array.isArray(rejection_reasons) ? rejection_reasons : (rejection_reasons ? [rejection_reasons] : null),
      evaluated_by ? String(evaluated_by).trim() : (req.user?.email || 'ADMIN'),
      id
    ];

    const { rows } = await pool.query(query, values);
    if (rows.length === 0) return res.status(404).json({ message: 'Record not found' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('updateEligibilityDecisionLog:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** DELETE eligibility_decision_logs/:id */
exports.deleteEligibilityDecisionLog = async (req, res) => {
  try {
    const { id } = req.params;
    const query = 'DELETE FROM eligibility_decision_logs WHERE id = $1 RETURNING *';
    const { rows } = await pool.query(query, [id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Record not found' });
    res.json({ message: 'Record deleted successfully' });
  } catch (err) {
    logger.error('deleteEligibilityDecisionLog:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** PUT student_placement_violations/:id */
exports.updatePlacementViolation = async (req, res) => {
  try {
    const { id } = req.params;
    const { violation_type, penalty_type, penalty_days, remarks, is_active } = req.body;
    
    let pDays = null;
    if (penalty_type === 'TEMP_BAN' && penalty_days != null && penalty_days !== '') {
      pDays = parseInt(penalty_days, 10);
    }

    const query = `
      UPDATE student_placement_violations 
      SET violation_type = $1, penalty_type = $2, penalty_days = $3, remarks = $4, is_active = $5
      WHERE id = $6
      RETURNING *
    `;
    const values = [
      String(violation_type).trim(),
      penalty_type,
      pDays,
      remarks ? String(remarks).trim() : null,
      is_active !== undefined ? Boolean(is_active) : true,
      id
    ];

    const { rows } = await pool.query(query, values);
    if (rows.length === 0) return res.status(404).json({ message: 'Record not found' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('updatePlacementViolation:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** PUT student_disciplinary_records/:id */
exports.updateDisciplinaryRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const { violation_type, severity, description, start_date, end_date, is_active } = req.body;
    
    const query = `
      UPDATE student_disciplinary_records 
      SET violation_type = $1, severity = $2, description = $3, start_date = $4, end_date = $5, is_active = $6
      WHERE id = $7
      RETURNING *
    `;
    const values = [
      String(violation_type).trim(),
      severity,
      description ? String(description).trim() : null,
      String(start_date).trim(),
      end_date ? String(end_date).trim() : null,
      is_active !== undefined ? Boolean(is_active) : true,
      id
    ];

    const { rows } = await pool.query(query, values);
    if (rows.length === 0) return res.status(404).json({ message: 'Record not found' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('updateDisciplinaryRecord:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};
