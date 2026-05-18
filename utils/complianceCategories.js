/**
 * Violation category mapping for placement process UI.
 *
 * Categories:
 * - malpractice: process.malpractice flag OR placement violation type MALPRACTICE (drive-scoped)
 * - placement_policy: other active student_placement_violations for this drive / global policy
 * - disciplinary: active student_disciplinary_records (student-wide)
 */

const MALPRACTICE_TYPES = new Set(['MALPRACTICE']);

const PLACEMENT_POLICY_TYPES = new Set([
  'POLICY_BREACH',
  'MULTIPLE_OFFERS',
  'NO_SHOW',
  'FAKE_DOCUMENT',
  'DOCUMENT_FRAUD',
  'OFFER_REJECTED',
  'OTHER',
]);

function formatViolationLabel(type) {
  return String(type || 'VIOLATION')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function categorizePlacementViolationType(violationType) {
  const t = String(violationType || '').toUpperCase().trim();
  if (MALPRACTICE_TYPES.has(t)) return 'malpractice';
  if (PLACEMENT_POLICY_TYPES.has(t)) return 'placement_policy';
  return 'placement_policy';
}

function buildComplianceSummary({ malpracticeFlag, placementViolations, disciplinaryRecords, driveId }) {
  const driveViolations = placementViolations || [];
  const disciplinary = disciplinaryRecords || [];

  const malpracticeFromTable = driveViolations.filter(
    (v) => categorizePlacementViolationType(v.violation_type) === 'malpractice'
  );
  const policyFromTable = driveViolations.filter(
    (v) => categorizePlacementViolationType(v.violation_type) === 'placement_policy'
  );

  const categories = {
    malpractice: malpracticeFlag === true || malpracticeFromTable.length > 0,
    placement_policy: policyFromTable.length > 0,
    disciplinary: disciplinary.length > 0,
  };

  let primary_category = null;
  if (categories.malpractice) primary_category = 'malpractice';
  else if (categories.disciplinary) primary_category = 'disciplinary';
  else if (categories.placement_policy) primary_category = 'placement_policy';

  const labels = [];
  if (malpracticeFlag) labels.push('Malpractice (round flag)');
  malpracticeFromTable.forEach((v) => {
    const scope =
      v.placement_drive_id != null && String(v.placement_drive_id) === String(driveId)
        ? 'this drive'
        : 'global policy';
    labels.push(`Malpractice · ${scope}${v.remarks ? `: ${v.remarks}` : ''}`);
  });
  policyFromTable.forEach((v) => {
    const scope =
      v.placement_drive_id != null && String(v.placement_drive_id) === String(driveId)
        ? 'this drive'
        : 'global policy';
    labels.push(`${formatViolationLabel(v.violation_type)} · ${scope}`);
  });
  disciplinary.forEach((d) => {
    labels.push(`Disciplinary · ${formatViolationLabel(d.violation_type)} (${d.severity || '—'})`);
  });

  return {
    primary_category,
    categories,
    placement_violations: driveViolations,
    disciplinary_records: disciplinary,
    labels,
    tooltip: labels.length ? labels.join('\n') : null,
    has_compliance_issue: primary_category != null,
  };
}

module.exports = {
  categorizePlacementViolationType,
  formatViolationLabel,
  buildComplianceSummary,
};
