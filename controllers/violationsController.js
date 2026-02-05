const supabase = require('../config/supabaseClient');
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
    const { data, error } = await supabase
      .from('eligibility_decision_logs')
      .select(`
        *,
        drive:placements_drives (
          id,
          job_type,
          placement_status,
          company:companies (
            id,
            company_name
          )
        )
      `)
      .order('evaluated_at', { ascending: false });

    if (error) {
      logger.error('Eligibility decision logs:', apiMessage(error));
      return res.status(400).json({ message: apiMessage(error, 'Failed to fetch eligibility logs') });
    }
    res.json(data || []);
  } catch (err) {
    logger.error('getEligibilityDecisionLogs:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** GET student_placement_violations with drive info */
exports.getPlacementViolations = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('student_placement_violations')
      .select(`
        *,
        drive:placements_drives (
          id,
          job_type,
          company:companies (id, company_name)
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Placement violations:', apiMessage(error));
      return res.status(400).json({ message: apiMessage(error, 'Failed to fetch placement violations') });
    }
    res.json(data || []);
  } catch (err) {
    logger.error('getPlacementViolations:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/** GET student_disciplinary_records */
exports.getDisciplinaryRecords = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('student_disciplinary_records')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Disciplinary records:', apiMessage(error));
      return res.status(400).json({ message: apiMessage(error, 'Failed to fetch disciplinary records') });
    }
    res.json(data || []);
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
    const { data, error } = await supabase
      .from('student_placement_violations')
      .insert(payload)
      .select()
      .single();

    if (error) {
      logger.error('Create placement violation:', apiMessage(error));
      return res.status(400).json({ message: apiMessage(error, 'Failed to create violation') });
    }
    res.status(201).json(data);
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
    const payload = {
      usn: String(usn).trim(),
      placement_drive_id: parseInt(placement_drive_id, 10),
      is_eligible: Boolean(is_eligible),
      rejection_reasons: Array.isArray(rejection_reasons) ? rejection_reasons : (rejection_reasons ? [rejection_reasons] : null),
      evaluated_by: evaluated_by ? String(evaluated_by).trim() : (req.user?.email || 'ADMIN'),
      evaluated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('eligibility_decision_logs')
      .insert(payload)
      .select()
      .single();

    if (error) {
      logger.error('Create eligibility decision log:', apiMessage(error));
      return res.status(400).json({ message: apiMessage(error, 'Failed to create eligibility log') });
    }
    res.status(201).json(data);
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
    const { data, error } = await supabase
      .from('student_disciplinary_records')
      .insert(payload)
      .select()
      .single();

    if (error) {
      logger.error('Create disciplinary record:', apiMessage(error));
      return res.status(400).json({ message: apiMessage(error, 'Failed to create disciplinary record') });
    }
    res.status(201).json(data);
  } catch (err) {
    logger.error('createDisciplinaryRecord:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};
