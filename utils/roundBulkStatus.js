const ROUND_BOOLEAN_FIELDS = new Set([
  'oa_status',
  'gd_status',
  'technical_round_status',
  'interview_status',
  'hr_round_status',
  'final_select_status',
]);

/**
 * Parse spreadsheet status cell into DB value for a process field.
 * @returns {boolean|string|null|undefined} undefined = invalid
 */
function parseBulkRoundStatus(rawStatus, field) {
  const s = String(rawStatus ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  if (!s) return null;

  if (field === 'approved_status') {
    if (['selected', 'qualified', 'pass', 'passed', 'yes', 'true', '1'].includes(s)) {
      return 'Qualified';
    }
    if (['rejected', 'not qualified', 'not selected', 'failed', 'fail', 'no', 'false', '0'].includes(s)) {
      return 'Not Qualified';
    }
    if (['pending', 'skip', 'skipped'].includes(s)) return 'Pending';
    return undefined;
  }

  if (!ROUND_BOOLEAN_FIELDS.has(field)) return undefined;

  if (['selected', 'qualified', 'pass', 'passed', 'yes', 'true', '1'].includes(s)) return true;
  if (['rejected', 'not selected', 'failed', 'fail', 'no', 'false', '0'].includes(s)) return false;
  if (['pending', 'clear', ''].includes(s)) return null;
  return undefined;
}

function isRoundFieldAllowed(field) {
  return field === 'approved_status' || ROUND_BOOLEAN_FIELDS.has(field);
}

function clearLaterRoundFields(payload, roundField, roundFields) {
  const idx = roundFields.indexOf(roundField);
  if (idx < 0) return payload;
  const out = { ...payload };
  for (let i = idx + 1; i < roundFields.length; i++) {
    const f = roundFields[i];
    if (f && f !== 'approved_status') out[f] = null;
  }
  return out;
}

module.exports = {
  ROUND_BOOLEAN_FIELDS,
  parseBulkRoundStatus,
  isRoundFieldAllowed,
  clearLaterRoundFields,
};
