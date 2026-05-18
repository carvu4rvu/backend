/**
 * Placement round progression — derive display status with downstream NOT QUALIFIED.
 * DB stores boolean round fields (true/false/null); unreachable rounds must not show PENDING.
 */

const ROUND_LABEL_TO_FIELD = {
  registration: 'approved_status',
  approved: 'approved_status',
  eligible: 'is_eligible',
  oa: 'oa_status',
  'online assessment': 'oa_status',
  'coding test': 'oa_status',
  gd: 'gd_status',
  'group discussion': 'gd_status',
  technical: 'technical_round_status',
  'technical round': 'technical_round_status',
  'technical round 1': 'technical_round_status',
  'technical round 2': 'interview_status',
  interview: 'interview_status',
  'hr round': 'hr_round_status',
  hr: 'hr_round_status',
  final: 'final_select_status',
  'final selection': 'final_select_status',
};

function roundLabelsToFields(processRounds) {
  if (!Array.isArray(processRounds)) return [];
  return processRounds
    .map((r) => ROUND_LABEL_TO_FIELD[String(r || '').toLowerCase().trim()])
    .filter(Boolean);
}

const ROUND_FIELD_ORDER = [
  'registration_status',
  'approved_status',
  'oa_status',
  'gd_status',
  'technical_round_status',
  'interview_status',
  'hr_round_status',
];

function isRegistered(process) {
  return String(process?.registration_status || '').toLowerCase() === 'registered';
}

function getComplianceCategory(process) {
  if (process?.compliance?.primary_category) return process.compliance.primary_category;
  if (process?.malpractice === true) return 'malpractice';
  if ((process?.disciplinary ?? 0) > 0) return 'disciplinary';
  if ((process?.placement_violations ?? 0) > 0) return 'placement_policy';
  return null;
}

/**
 * Index of field in progression pipeline (-1 if not in pipeline).
 */
function fieldProgressIndex(field, roundFields) {
  if (field === 'registration_status') return 0;
  if (field === 'approved_status') return 1;
  const ri = roundFields.indexOf(field);
  if (ri >= 0) return 2 + ri;
  return -1;
}

/**
 * First terminal elimination before targetIndex (exclusive of target field's own failure).
 * Returns { reason, atIndex } or null.
 */
function findPriorTerminal(process, roundFields, targetIndex) {
  if (targetIndex <= 0) return null;

  if (targetIndex > 0 && !isRegistered(process)) {
    return { reason: 'not_registered', atIndex: 0 };
  }

  if (targetIndex > 1) {
    const approved = process?.approved_status;
    if (approved === 'Not Qualified') return { reason: 'rejected', atIndex: 1 };
    if (approved !== 'Qualified' && approved !== 'skipped') {
      return { reason: 'not_approved', atIndex: 1 };
    }
  }

  if (targetIndex > 2) {
    const cat = getComplianceCategory(process);
    if (cat === 'disciplinary') return { reason: 'disciplinary', atIndex: 2 };
    if (cat === 'placement_policy') return { reason: 'policy', atIndex: 2 };
    if (String(process?.attendance || '').toLowerCase() === 'absent') {
      return { reason: 'absent', atIndex: 2 };
    }
  }

  for (let ri = 0; ri < roundFields.length; ri++) {
    const progIdx = 2 + ri;
    if (progIdx >= targetIndex) break;
    const f = roundFields[ri];
    if (!f) continue;
    if (process[f] === false) {
      return { reason: 'failed_round', atIndex: progIdx, field: f };
    }
  }

  return null;
}

/**
 * Effective display for one process field.
 * @returns {{ key: string, label: string, cssClass: string }}
 */
function getEffectiveRoundStatus(process, field, roundFields = []) {
  const roundFieldsList = Array.isArray(roundFields) ? roundFields : [];
  const idx = fieldProgressIndex(field, roundFieldsList);

  if (field === 'registration_status') {
    const v = String(process?.registration_status || '').toLowerCase();
    if (v === 'registered') return { key: 'passed', label: 'REGISTERED', cssClass: 'status-pass' };
    if (v === 'not registered') return { key: 'failed', label: 'NOT REGISTERED', cssClass: 'status-fail' };
    return { key: 'pending', label: 'PENDING', cssClass: 'status-pending' };
  }

  if (field === 'approved_status') {
    const prior = findPriorTerminal(process, roundFieldsList, idx);
    if (prior) return { key: 'not_qualified', label: 'NOT QUALIFIED', cssClass: 'status-not-qualified' };
    const v = process?.approved_status;
    if (v === 'Qualified') return { key: 'passed', label: 'QUALIFIED', cssClass: 'status-pass' };
    if (v === 'Not Qualified') return { key: 'failed', label: 'NOT QUALIFIED', cssClass: 'status-fail' };
    if (v === 'skipped') return { key: 'skipped', label: 'SKIPPED', cssClass: 'status-not-qualified' };
    return { key: 'pending', label: 'PENDING', cssClass: 'status-pending' };
  }

  if (idx < 0) {
    const raw = process?.[field];
    if (raw === true) return { key: 'passed', label: 'PASSED', cssClass: 'status-pass' };
    if (raw === false) return { key: 'failed', label: 'FAILED', cssClass: 'status-fail' };
    return { key: 'pending', label: 'PENDING', cssClass: 'status-pending' };
  }

  const prior = findPriorTerminal(process, roundFieldsList, idx);
  if (prior) {
    return { key: 'not_qualified', label: 'NOT QUALIFIED', cssClass: 'status-not-qualified' };
  }

  const raw = process?.[field];

  if (process?.malpractice === true && raw === false) {
    return { key: 'malpractice', label: 'MALPRACTICE', cssClass: 'status-malpractice' };
  }

  if (raw === true) return { key: 'passed', label: 'PASSED', cssClass: 'status-pass' };
  if (raw === false) {
    if (process?.malpractice === true) {
      return { key: 'malpractice', label: 'MALPRACTICE', cssClass: 'status-malpractice' };
    }
    return { key: 'failed', label: 'FAILED', cssClass: 'status-fail' };
  }

  return { key: 'pending', label: 'PENDING', cssClass: 'status-pending' };
}

/** Whether student may appear on round tab (includes eliminated for NQ display). */
function isVisibleOnRoundTab(process, roundIndex, roundFields) {
  if (!isRegistered(process)) return roundIndex === -2;
  if (roundIndex === -3) return isRegistered(process);
  if (roundIndex < 0) return true;
  if (process.approved_status !== 'Qualified') return roundIndex <= -3;

  for (let j = 0; j < roundIndex; j++) {
    const f = roundFields[j];
    if (f && process[f] === false) return true;
  }

  for (let j = 0; j < roundIndex; j++) {
    const f = roundFields[j];
    if (f && process[f] !== true) return false;
  }
  return true;
}

/** Propagate display labels onto row for API/export (optional enrichment). */
function enrichProcessRoundDisplays(row, processRounds) {
  const roundFields = roundLabelsToFields(processRounds);

  const effective = {};
  const fields = ['registration_status', 'approved_status', ...roundFields];
  fields.forEach((f) => {
    const st = getEffectiveRoundStatus(row, f, roundFields);
    effective[`effective_${f}`] = st;
  });

  return {
    ...row,
    _round_fields: roundFields,
    ...effective,
  };
}

const EXPORT_STATUS_FIELDS = [
  'registration_status',
  'approved_status',
  'oa_status',
  'gd_status',
  'technical_round_status',
  'interview_status',
  'hr_round_status',
];

function formatStatusForExport(row, field, processRounds) {
  const roundFields = roundLabelsToFields(processRounds);
  return getEffectiveRoundStatus(row, field, roundFields).label;
}

module.exports = {
  getEffectiveRoundStatus,
  findPriorTerminal,
  isVisibleOnRoundTab,
  enrichProcessRoundDisplays,
  formatStatusForExport,
  roundLabelsToFields,
  isRegistered,
};
