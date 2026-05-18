const violationsDb = require('../db/violationsDb');
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
    const rows = await violationsDb.getEligibilityDecisionLogs();
    res.json(rows.map(violationsDb.shapeLogRow));
  } catch (err) {
    logger.error('getEligibilityDecisionLogs:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** GET student_placement_violations with drive info */
exports.getPlacementViolations = async (req, res) => {
  try {
    const rows = await violationsDb.getPlacementViolations();
    res.json(rows.map(violationsDb.shapeViolationRow));
  } catch (err) {
    logger.error('getPlacementViolations:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** GET student_disciplinary_records */
exports.getDisciplinaryRecords = async (req, res) => {
  try {
    const rows = await violationsDb.getDisciplinaryRecords();
    res.json(rows);
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
    const payload = {
      usn: String(usn).trim(),
      violation_type: String(violation_type).trim(),
      penalty_type,
      is_active: true,
      remarks: remarks ? String(remarks).trim() : null,
      created_by: req.user?.id || null,
    };
    if (placement_drive_id != null && placement_drive_id !== '') {
      const driveId = parseInt(placement_drive_id, 10);
      if (!Number.isNaN(driveId)) payload.placement_drive_id = driveId;
    }
    if (penalty_type === 'TEMP_BAN' && penalty_days != null && penalty_days !== '') {
      const days = parseInt(penalty_days, 10);
      if (!Number.isNaN(days) && days > 0) payload.penalty_days = days;
    }
    const data = await violationsDb.insertPlacementViolation(payload);
    res.status(201).json(data);
  } catch (err) {
    logger.error('createPlacementViolation:', err);
    res.status(400).json({ message: apiMessage(err, 'Failed to create violation') });
  }
};

/** POST eligibility_decision_logs */
exports.createEligibilityDecisionLog = async (req, res) => {
  try {
    const { usn, placement_drive_id, is_eligible, rejection_reasons, evaluated_by } = req.body;
    if (!usn || !placement_drive_id || is_eligible === undefined) {
      return res.status(400).json({ message: 'usn, placement_drive_id, and is_eligible are required' });
    }
    const payload = {
      usn: String(usn).trim(),
      placement_drive_id: parseInt(placement_drive_id, 10),
      is_eligible: Boolean(is_eligible),
      rejection_reasons: Array.isArray(rejection_reasons) ? rejection_reasons : (rejection_reasons ? [rejection_reasons] : null),
      evaluated_by: evaluated_by ? String(evaluated_by).trim() : (req.user?.email || 'ADMIN'),
      evaluated_at: new Date().toISOString(),
    };
    const data = await violationsDb.insertEligibilityDecisionLog(payload);
    res.status(201).json(data);
  } catch (err) {
    logger.error('createEligibilityDecisionLog:', err);
    res.status(400).json({ message: apiMessage(err, 'Failed to create eligibility log') });
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
    const payload = {
      usn: String(usn).trim(),
      violation_type: String(violation_type).trim(),
      severity,
      description: description ? String(description).trim() : null,
      is_active: true,
      start_date: String(start_date).trim(),
      end_date: end_date ? String(end_date).trim() : null,
      reported_by: req.user?.id || null,
    };
    const data = await violationsDb.insertDisciplinaryRecord(payload);
    res.status(201).json(data);
  } catch (err) {
    logger.error('createDisciplinaryRecord:', err);
    res.status(400).json({ message: apiMessage(err, 'Failed to create disciplinary record') });
  }
};
