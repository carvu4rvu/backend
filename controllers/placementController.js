const pool = require('../config/db');
const placementDb = require('../db/placementDb');
const dashboardDb = require('../db/dashboardDb');
const catalogDb = require('../db/catalogDb');
const policiesDb = require('../db/policiesDb');
const alumniDb = require('../db/alumniDb');
const studentDb = require('../db/studentDb');
const logger = require('../utils/logger');
const { createAndSendToUsns } = require('../utils/notificationHelper');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/** Fetch drive details for notifications: company_name, job_description, last_date_to_registration, event_datetime */
async function getDriveForNotification(driveId) {
  const data = await placementDb.getDriveForNotification(driveId);
  if (!data) return null;
  return {
    company_name: data.company_name || 'Company',
    job_description: data.job_description || '',
    last_date_to_registration: data.last_date_to_registration,
    event_datetime: data.event_datetime,
  };
}

/** Format date for notification message */
function formatNotificationDate(iso) {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Round field key to display label */
const ROUND_LABELS = {
  oa_status: 'OA',
  gd_status: 'GD',
  technical_round_status: 'Technical',
  interview_status: 'Interview',
  hr_round_status: 'HR',
  final_select_status: 'Final Select',
};

/** Parse integer from string/number; return null if invalid or NaN */
function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

/** Remove Aptitude from process_rounds (no DB field; not used) */
function sanitizeProcessRounds(rounds) {
  if (!Array.isArray(rounds)) return rounds;
  return rounds.filter((r) => {
    const s = String(r || '').trim();
    return s !== '' && !/^aptitude$/i.test(s);
  });
}

/** Normalize API error message from Supabase or generic Error */
function apiMessage(err, fallback = 'Server error') {
  if (!err) return fallback;
  if (typeof err.message === 'string' && err.message.trim()) return err.message.trim();
  if (err.error_description) return String(err.error_description);
  if (err.details) return String(err.details);
  return fallback;
}

const PG_ARRAY_CHUNK = 400;

function chunkArray(arr, size = PG_ARRAY_CHUNK) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/** Single drive + company via PG (avoids Supabase REST timeouts). */
async function fetchPlacementsDriveByIdPg(id) {
  const { rows } = await pool.query(
    `SELECT pd.*, row_to_json(c.*) AS company
     FROM placements_drives pd
     LEFT JOIN companies c ON c.id = pd.company_id
     WHERE pd.id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    ...row,
    company: row.company && typeof row.company === 'object' ? row.company : null,
  };
}

async function fetchSchoolNamePg(schoolId) {
  if (schoolId == null) return null;
  const { rows } = await pool.query('SELECT name FROM schools WHERE id = $1', [schoolId]);
  return rows[0]?.name ?? null;
}

async function fetchProgramNamePg(programId) {
  if (programId == null) return null;
  const { rows } = await pool.query('SELECT name FROM programs WHERE id = $1', [programId]);
  return rows[0]?.name ?? null;
}

let academicsTableSource = null;

/** Prefer student_semester_records (current schema); fall back to legacy table or Supabase. */
async function resolveAcademicsTableSource() {
  if (academicsTableSource) return academicsTableSource;
  try {
    const { rows } = await pool.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'student_semester_records'
         ) AS has_records,
         EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'student_semester_academics'
         ) AS has_legacy`
    );
    const { has_records, has_legacy } = rows[0] || {};
    if (has_records) academicsTableSource = 'records';
    else if (has_legacy) academicsTableSource = 'legacy';
    else academicsTableSource = 'legacy';
  } catch {
    academicsTableSource = 'legacy';
  }
  return academicsTableSource;
}

async function fetchEducationHistoryChunk(chunk) {
  try {
    const eduRes = await pool.query(
      `SELECT usn, education_level, result, result_type
       FROM student_education_history
       WHERE usn = ANY($1::text[])
         AND education_level IN ('10TH', '12TH', 'DIPLOMA')`,
      [chunk]
    );
    return eduRes.rows || [];
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

function applyEducationRows(map, educationRows) {
  educationRows.forEach((row) => {
    const student = map.get(row.usn) || {
      latest_sgpa: null,
      live_backlogs: 0,
      closed_backlogs: 0,
      latest_academic_year: null,
    };
    if (!map.has(row.usn)) map.set(row.usn, student);

    const resultVal = parseFloat(row.result);
    if (!Number.isNaN(resultVal)) {
      if (row.education_level === '10TH') {
        student.percent_10th = row.result_type === 'CGPA' ? resultVal * 9.5 : resultVal;
      } else if (row.education_level === '12TH') {
        student.percent_12th = row.result_type === 'CGPA' ? resultVal * 9.5 : resultVal;
      } else if (row.education_level === 'DIPLOMA') {
        student.percent_diploma = row.result_type === 'CGPA' ? resultVal * 9.5 : resultVal;
      }
    }
  });
}

/** Get latest academic metrics per student (PG pool — avoids Supabase timeouts on large USN lists). */
async function getStudentAcademicsMap(usns) {
  if (!usns || usns.length === 0) return new Map();
  const map = new Map();
  const totalByUsn = {};
  const source = await resolveAcademicsTableSource();

  const useRecords = source === 'records';
  const tableName = useRecords ? 'student_semester_records' : 'student_semester_academics';
  const latestSgpaExpr = useRecords ? 'COALESCE(cgpa, sgpa)' : 'result_in_sgpa';
  const liveBacklogsExpr = useRecords ? 'COALESCE(active_backlogs, 0)' : 'COALESCE(live_backlogs, 0)';
  const closedBacklogsExpr = useRecords ? 'COALESCE(cleared_backlogs, 0)' : 'COALESCE(closed_backlogs, 0)';
  const sumClosedExpr = useRecords ? 'cleared_backlogs' : 'closed_backlogs';

  for (const chunk of chunkArray(usns)) {
    const [acadRes, histRes, eduRows] = await Promise.all([
      pool.query(
        `SELECT DISTINCT ON (usn)
           usn, academic_year, semester,
           ${latestSgpaExpr} AS latest_sgpa,
           ${liveBacklogsExpr} AS live_backlogs,
           ${closedBacklogsExpr} AS closed_backlogs
         FROM public.${tableName}
         WHERE usn = ANY($1::text[])
         ORDER BY usn, academic_year DESC NULLS LAST, semester DESC NULLS LAST`,
        [chunk]
      ),
      pool.query(
        `SELECT usn, COALESCE(SUM(${sumClosedExpr}), 0)::int AS total_closed
         FROM public.${tableName}
         WHERE usn = ANY($1::text[])
         GROUP BY usn`,
        [chunk]
      ),
      fetchEducationHistoryChunk(chunk),
    ]);

    (histRes.rows || []).forEach((row) => {
      totalByUsn[row.usn] = row.total_closed ?? 0;
    });

    (acadRes.rows || []).forEach((row) => {
      if (!row.usn) return;
      map.set(row.usn, {
        latest_sgpa: row.latest_sgpa != null ? parseFloat(row.latest_sgpa) : null,
        live_backlogs: row.live_backlogs != null ? parseInt(row.live_backlogs, 10) : 0,
        closed_backlogs: row.closed_backlogs != null ? parseInt(row.closed_backlogs, 10) : 0,
        latest_academic_year: row.academic_year,
      });
    });

    applyEducationRows(map, eduRows);
  }

  for (const [usn, m] of map) {
    m.total_backlog_history = totalByUsn[usn] ?? m.closed_backlogs ?? 0;
  }
  return map;
}

/**
 * Attach offers, CTC, violations, disciplinary, and profile lock for client-side filters.
 * Uses PG pool with chunked ANY($1) — Supabase .in() fails/truncates with 2000+ USNs.
 */
async function attachPlacementStats(list, usns) {
  if (!list?.length || !usns?.length) return list;
  const perUsn = {};
  usns.forEach((u) => {
    perUsn[u] = {
      offers_count: 0,
      max_ctc_lpa: null,
      has_placement_from_drive: false,
      placement_violations: 0,
      disciplinary: 0,
    };
  });

  for (const chunk of chunkArray(usns)) {
    const queries = [
      pool.query(
        `SELECT usn, COUNT(*)::int AS cnt FROM student_placement_violations
         WHERE usn = ANY($1::text[]) AND is_active = true GROUP BY usn`,
        [chunk]
      ),
      pool.query(
        `SELECT usn, COUNT(*)::int AS cnt FROM student_disciplinary_records
         WHERE usn = ANY($1::text[]) AND is_active = true GROUP BY usn`,
        [chunk]
      ),
      pool.query(
        `SELECT student_id, placement_id, capstone_id FROM offers WHERE student_id = ANY($1::text[])`,
        [chunk]
      ),
      pool.query(
        `SELECT student_id, ctc_min_lpa, ctc_max_lpa FROM placement WHERE student_id = ANY($1::text[])`,
        [chunk]
      ),
    ];

    const [violRes, discRes, offersRes, plcRes] = await Promise.all(queries);

    (violRes.rows || []).forEach((v) => {
      if (perUsn[v.usn]) perUsn[v.usn].placement_violations = v.cnt;
    });
    (discRes.rows || []).forEach((d) => {
      if (perUsn[d.usn]) perUsn[d.usn].disciplinary = d.cnt;
    });
    (offersRes.rows || []).forEach((off) => {
      const o = perUsn[off.student_id];
      if (!o) return;
      o.offers_count += 1;
      if (off.placement_id) o.has_placement_from_drive = true;
    });
    (plcRes.rows || []).forEach((pl) => {
      const o = perUsn[pl.student_id];
      if (!o) return;
      const ctc = pl.ctc_max_lpa != null ? pl.ctc_max_lpa : pl.ctc_min_lpa;
      if (ctc != null && (o.max_ctc_lpa == null || Number(ctc) > o.max_ctc_lpa)) o.max_ctc_lpa = Number(ctc);
    });
  }

  return list.map((s) => {
    const agg = perUsn[s.usn] || {};
    const offersCount = agg.offers_count ?? 0;
    return {
      ...s,
      offers_count: offersCount,
      max_ctc_lpa: agg.max_ctc_lpa != null ? agg.max_ctc_lpa : null,
      is_placed: offersCount > 0,
      is_placed_off_campus: offersCount > 0 && !agg.has_placement_from_drive,
      placement_violations: agg.placement_violations ?? 0,
      disciplinary: agg.disciplinary ?? 0,
    };
  });
}

/** Attach drive-scoped compliance details for process list highlighting (category-aware). */
async function attachDriveComplianceDetails(rows, driveId) {
  if (!rows?.length) return rows;
  const violationsDb = require('../db/violationsDb');
  const { buildComplianceSummary } = require('../utils/complianceCategories');

  const usns = [...new Set(rows.map((r) => r.usn).filter(Boolean))];
  if (!usns.length) return rows;

  const { violationsByUsn, disciplinaryByUsn } = await violationsDb.getDriveComplianceMaps(usns, driveId);

  const stats = { malpractice: 0, placement_policy: 0, disciplinary: 0, none: 0 };

  const enriched = rows.map((row) => {
    const placementViolations = violationsByUsn[row.usn] || [];
    const disciplinaryRecords = disciplinaryByUsn[row.usn] || [];
    const compliance = buildComplianceSummary({
      malpracticeFlag: row.malpractice === true,
      placementViolations,
      disciplinaryRecords,
      driveId,
    });

    if (compliance.primary_category === 'malpractice') stats.malpractice += 1;
    else if (compliance.primary_category === 'disciplinary') stats.disciplinary += 1;
    else if (compliance.primary_category === 'placement_policy') stats.placement_policy += 1;
    else stats.none += 1;

    return {
      ...row,
      compliance,
      compliance_labels: compliance.labels,
      placement_violations: placementViolations.length,
      disciplinary: disciplinaryRecords.length,
      has_compliance_issue: compliance.has_compliance_issue,
    };
  });

  logger.info(
    `[compliance] drive=${driveId} rows=${rows.length} malpractice=${stats.malpractice} ` +
      `placement_policy=${stats.placement_policy} disciplinary=${stats.disciplinary} clean=${stats.none}`
  );

  return enriched;
}

/** Evaluate student against eligibility_criteria rules (from placements_drives). */
function evaluateEligibility(student, eligibility, opts = {}) {
  const reasons = [];
  if (!eligibility) return { isEligible: true, rejectionReasons: [] };
  const adminOverride = opts.adminOverride === true && eligibility.admin_override_allowed === true;
  const inIntArray = (arr, val) => {
    if (!arr || !Array.isArray(arr) || arr.length === 0) return true;
    const v = typeof val === 'number' ? val : parseInt(val, 10);
    return !Number.isNaN(v) && arr.includes(v);
  };
  if (eligibility.min_cgpa != null && student.latest_sgpa != null) {
    const sgpa = parseFloat(student.latest_sgpa);
    if (!Number.isNaN(sgpa) && sgpa < parseFloat(eligibility.min_cgpa)) reasons.push(`CGPA ${sgpa} below min ${eligibility.min_cgpa}`);
  }
  if (eligibility.max_cgpa != null && student.latest_sgpa != null) {
    const sgpa = parseFloat(student.latest_sgpa);
    if (!Number.isNaN(sgpa) && sgpa > parseFloat(eligibility.max_cgpa)) reasons.push(`CGPA ${sgpa} above max ${eligibility.max_cgpa}`);
  }
  if (eligibility.max_active_backlogs != null && (student.live_backlogs ?? 0) > eligibility.max_active_backlogs) {
    reasons.push(`Active backlogs ${student.live_backlogs} exceeds max ${eligibility.max_active_backlogs}`);
  }
  if (eligibility.max_backlog_history != null && (student.total_backlog_history ?? student.closed_backlogs ?? 0) > eligibility.max_backlog_history) {
    const hist = student.total_backlog_history ?? student.closed_backlogs ?? 0;
    reasons.push(`Backlog history ${hist} exceeds max ${eligibility.max_backlog_history}`);
  }
  if (eligibility.eligible_years?.length && !inIntArray(eligibility.eligible_years, student.current_year)) {
    reasons.push(`Current year ${student.current_year} not in eligible years`);
  }
  if (eligibility.eligible_semesters?.length && !inIntArray(eligibility.eligible_semesters, student.current_semester)) {
    reasons.push(`Current semester ${student.current_semester} not in eligible semesters`);
  }
  if (eligibility.allowed_school_ids?.length && !inIntArray(eligibility.allowed_school_ids, student.school_id)) reasons.push(`School not in allowed list`);
  if (eligibility.allowed_program_ids?.length && !inIntArray(eligibility.allowed_program_ids, student.program_id)) reasons.push(`Program not in allowed list`);
  if (eligibility.allowed_major_ids?.length && student.major_id != null && !inIntArray(eligibility.allowed_major_ids, student.major_id)) reasons.push(`Major not in allowed list`);
  if (eligibility.allowed_specialization_ids?.length && student.specialization_id != null && !inIntArray(eligibility.allowed_specialization_ids, student.specialization_id)) reasons.push(`Specialization not in allowed list`);
  if (eligibility.joining_years?.length && !inIntArray(eligibility.joining_years, student.year_of_joining)) reasons.push(`Joining year ${student.year_of_joining} not in allowed list`);
  if (eligibility.graduation_years?.length && student.graduation_year != null && !inIntArray(eligibility.graduation_years, student.graduation_year)) reasons.push(`Graduation year not in allowed list`);

  // New filters
  if (eligibility.allowed_genders?.length) {
    const genders = (eligibility.allowed_genders || []).map(g => String(g).toLowerCase());
    if (!genders.includes(String(student.gender || '').toLowerCase())) reasons.push(`Gender ${student.gender || 'Unknown'} not in allowed list`);
  }
  if (eligibility.allowed_years?.length && !inIntArray(eligibility.allowed_years, student.current_year)) {
    reasons.push(`Current year ${student.current_year} not in allowed list`);
  }
  if (eligibility.allowed_semesters?.length && !inIntArray(eligibility.allowed_semesters, student.current_semester)) {
    reasons.push(`Current semester ${student.current_semester} not in allowed list`);
  }
  if (eligibility.allowed_sections?.length) {
    const sections = (eligibility.allowed_sections || []).map(s => String(s).toUpperCase());
    if (!sections.includes(String(student.section || '').toUpperCase())) reasons.push(`Section ${student.section || 'Unknown'} not in allowed list`);
  }
  if (eligibility.min_10th_percent != null && student.percent_10th != null) {
    const val = parseFloat(student.percent_10th);
    const min = parseFloat(eligibility.min_10th_percent);
    if (!isNaN(val) && !isNaN(min) && val < min) reasons.push(`10th % ${val} below min ${min}`);
  }
  if (eligibility.min_12th_percent != null && student.percent_12th != null) {
    const val = parseFloat(student.percent_12th);
    const min = parseFloat(eligibility.min_12th_percent);
    if (!isNaN(val) && !isNaN(min) && val < min) reasons.push(`12th % ${val} below min ${min}`);
  }
  if (eligibility.min_diploma_percent != null && student.percent_diploma != null) {
    const val = parseFloat(student.percent_diploma);
    const min = parseFloat(eligibility.min_diploma_percent);
    if (!isNaN(val) && !isNaN(min) && val < min) reasons.push(`Diploma % ${val} below min ${min}`);
  }

  const isEligible = reasons.length === 0 || adminOverride;
  return { isEligible, rejectionReasons: reasons };
}

exports.applyToDrive = async (req, res) => {
  try {
    const { driveId } = req.params;
    const usn = req.body?.usn ?? req.user?.usn;
    const adminOverride = req.body?.admin_override === true;
    if (!usn) return res.status(400).json({ message: 'USN is required' });
    const driveIdNum = parseInt(driveId, 10);
    if (isNaN(driveIdNum)) return res.status(400).json({ message: 'Invalid drive ID' });

    const studentRow = await placementDb.getStudentForApply(usn);
    if (!studentRow) return res.status(403).json({ message: 'Student record not found' });
    if (studentRow.opt_in !== true) return res.status(403).json({ message: 'You must opt in to placement from your Personal profile before applying to drives' });

    const existing = await placementDb.getProcessByDriveAndUsn(driveIdNum, usn);

    const isSelfRegistration = req.user?.usn && String(req.user.usn).toLowerCase() === String(usn).toLowerCase();

    if (existing) {
      if (isSelfRegistration) {
        const currentStatus = String(existing.registration_status || '').toUpperCase();
        if (currentStatus !== 'REGISTERED') {
          const updated = await placementDb.updateProcessById(existing.id, { registration_status: 'REGISTERED' });
          if (!updated) {
            return res.status(400).json({ message: 'Update failed' });
          }
          return res.status(200).json(updated);
        }
        return res.status(200).json(existing);
      }
      return res.status(200).json({ message: 'Already applied', data: existing });
    }

    // Self-registration (student applying) = Registered; admin adding students = Pending
    const registrationStatus = isSelfRegistration ? 'REGISTERED' : 'Pending';

    const eligibility = await placementDb.getDriveEligibilityCriteria(driveIdNum);

    let isEligible = true;
    if (eligibility) {
      const academicsMap = await getStudentAcademicsMap([usn]);
      const ac = academicsMap.get(usn) || {};
      const maxYears = studentRow.max_duration_years ?? 4;
      const gradYear = studentRow.year_of_joining != null ? studentRow.year_of_joining + maxYears : null;
      const studentForEval = {
        ...studentRow,
        latest_sgpa: ac.latest_sgpa,
        live_backlogs: ac.live_backlogs ?? 0,
        closed_backlogs: ac.closed_backlogs ?? 0,
        total_backlog_history: ac.total_backlog_history ?? 0,
        graduation_year: gradYear,
      };
      const role = (req.user?.role || '').toString().toLowerCase();
      const isAdmin = role === 'admin';
      const { isEligible: eligible, rejectionReasons } = evaluateEligibility(studentForEval, eligibility, {
        adminOverride: isAdmin && adminOverride && eligibility.admin_override_allowed === true,
      });
      isEligible = eligible;
      if (!isEligible && !(isAdmin && adminOverride && eligibility.admin_override_allowed)) {
        const msg = rejectionReasons && rejectionReasons.length ? rejectionReasons.join('; ') : 'Does not meet eligibility criteria';
        return res.status(403).json({ message: `Eligibility check failed: ${msg}` });
      }
    }

    let inserted;
    try {
      inserted = await placementDb.insertProcess({
        usn,
        placement_drive_id: driveIdNum,
        is_eligible: isEligible,
        registration_status: registrationStatus,
      });
    } catch (error) {
      logger.error('Apply to drive:', apiMessage(error, 'Apply failed'));
      return res.status(400).json({ message: apiMessage(error, 'Apply failed') });
    }
    const driveRegistrationLink = `${FRONTEND_URL}/student/placements/drive/${driveIdNum}`;
    getDriveForNotification(driveIdNum).then((driveInfo) => {
      const title = (driveInfo && driveInfo.company_name) || 'Placement drive';
      const desc = (driveInfo && driveInfo.job_description) || 'You have been added to a placement drive.';
      const deadlineStr = driveInfo && driveInfo.last_date_to_registration
        ? formatNotificationDate(driveInfo.last_date_to_registration)
        : 'TBD';
      const message = `${desc}\n\nRegistration deadline: ${deadlineStr}`;
      return createAndSendToUsns(
        {
          title,
          message,
          link: driveRegistrationLink,
          notification_type: 'PLACEMENT',
          created_by: req.user?.id || null,
        },
        [usn]
      );
    }).catch((notifErr) => logger.warn('Drive registration notification failed', notifErr?.message));
    res.status(201).json(inserted);
  } catch (err) {
    logger.error('Apply to drive:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

exports.getStudentApplications = async (req, res) => {
  try {
    const { usn } = req.params;
    const authUsn = req.user?.usn;
    if (!authUsn) return res.status(403).json({ message: 'Authentication required' });
    // Only allow fetching own applications; students must be opted in (server-side check)
    if (String(authUsn).toLowerCase() !== String(usn).toLowerCase()) {
      return res.status(403).json({ message: 'You can only view your own applications' });
    }
    const studentRow = await placementDb.getStudentOptIn(usn);
    if (!studentRow) return res.status(403).json({ message: 'Student record not found' });
    if (studentRow.opt_in !== true) return res.status(403).json({ message: 'You must opt in to placement to view applications' });

    const formattedData = await placementDb.getStudentApplications(usn);
    res.json(formattedData);
  } catch (error) {
    logger.error('Error fetching student applications:', error);
    res.status(500).json({ message: apiMessage(error, 'Server error') });
  }
};

/**
 * GET /placement/offers/:usn - Student job offers. Server verifies opt_in and identity.
 */
exports.getStudentOffers = async (req, res) => {
  try {
    const { usn } = req.params;
    const authUsn = req.user?.usn;
    if (!authUsn) return res.status(403).json({ message: 'Authentication required' });
    if (String(authUsn).toLowerCase() !== String(usn).toLowerCase()) {
      return res.status(403).json({ message: 'You can only view your own offers' });
    }
    const studentRow = await placementDb.getStudentOptIn(usn);
    if (!studentRow) return res.status(403).json({ message: 'Student record not found' });
    if (studentRow.opt_in !== true) return res.status(403).json({ message: 'You must opt in to placement to view job offers' });

    const placements = await placementDb.getStudentPlacements(usn);
    const placementIds = placements.map((p) => p.id).filter(Boolean);
    let offerByPlacementId = {};
    if (placementIds.length > 0) {
      const offerRows = await placementDb.getOffersByStudentAndPlacements(usn, placementIds);
      offerRows.forEach((o) => {
        if (o.placement_id != null) offerByPlacementId[o.placement_id] = o;
      });
    }

    const list = placements.map((p) => {
      const offer = offerByPlacementId[p.id];
      return {
        id: p.id,
        offer_id: offer?.id ?? null,
        student_id: p.student_id,
        usn: p.student_id,
        company_name: p.company_name,
        designation: p.designation,
        offer_letter_status: p.offer_letter_status,
        ctc_min_lpa: p.ctc_min_lpa,
        ctc_max_lpa: p.ctc_max_lpa,
        type_of_hiring: p.type_of_hiring,
        academic_year: p.academic_year,
        remarks: p.remarks,
        is_accepted: offer?.is_accepted,
        offer_remarks: offer?.remarks
      };
    });

    res.json(list);
  } catch (error) {
    logger.error('Error fetching student offers:', error);
    res.status(500).json({ message: apiMessage(error, 'Server error') });
  }
};

/**
 * PATCH /offers/decision
 */
exports.submitOfferDecision = async (req, res) => {
  try {
    const authUsn = req.user?.usn;
    const { offer_id, is_accepted } = req.body;

    if (!authUsn) return res.status(401).json({ message: 'Unauthorized' });
    if (!offer_id) return res.status(400).json({ message: 'Offer ID required' });

    const offerRow = await placementDb.getOfferWithPlacement(offer_id);
    if (!offerRow) return res.status(404).json({ message: 'Offer not found' });
    if (String(offerRow.student_id) !== String(authUsn)) return res.status(403).json({ message: 'Not your offer' });

    const placementRow = offerRow.placement;
    const companyName = offerRow.placement_company_name || placementRow?.company_name;
    const isAccepted = is_accepted === true || String(is_accepted) === 'true';

    await placementDb.updateOffer(offer_id, { is_accepted: isAccepted });

    if (isAccepted && placementRow) {
      const capstoneRow = await placementDb.insertCapstone({
        usn: authUsn,
        company_name: companyName || 'Company',
        designation: placementRow.designation || null,
        offer_letter_status: 'Accepted',
        internship_stipend_min: placementRow.ctc_min_lpa || null,
        internship_stipend_max: placementRow.ctc_max_lpa || null,
        academic_year: placementRow.academic_year || null,
        remarks: placementRow.remarks || null,
      });
      if (capstoneRow?.id) {
        await placementDb.updateOffer(offer_id, { capstone_id: capstoneRow.id });
      }
    }

    return res.json({ message: isAccepted ? 'Offer accepted' : 'Offer rejected', success: true });
  } catch (err) {
    logger.error('submitOfferDecision:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to submit decision') });
  }
};

/**
 * GET /placement/process/list
 * Returns all student_placement_process records with drive and student details (admin Process page).
 */
exports.getAllProcessList = async (req, res) => {
  try {
    const data = await placementDb.getAllProcessListRows();
    const rows = data.map((row) => ({
      ...row,
      company_name: row.company_name || '-',
      drive_id: row.drive_id,
      job_type: row.job_type,
      event_datetime: row.event_datetime,
      placement_status: row.placement_status,
      student_name: row.student_full_name || '-',
    }));
    res.json(rows);
  } catch (error) {
    logger.error('Error fetching process list:', error);
    res.status(500).json({ message: apiMessage(error, 'Server error') });
  }
};

exports.getAllDrives = async (req, res) => {
  const routeStart = Date.now();
  try {
    // For students: verify opt-in on every request (never trust client/cache)
    const role = (req.user?.role || '').toString().toLowerCase();
    if (role === 'student' && req.user?.usn) {
      const studentRow = await placementDb.getStudentOptIn(req.user.usn);
      if (!studentRow || studentRow.opt_in !== true) {
        return res.status(403).json({ message: 'You must opt in to placement from your Personal profile to view drives' });
      }
    }

    const data = await placementDb.fetchAllDrivesRows();
    const driveIds = data.map((d) => d.id).filter(Boolean);
    const [{ counts: registeredCountByDrive }, pairsByDrive] = await Promise.all([
      placementDb.getRegistrationCountsByDrive(driveIds),
      placementDb.getSchoolProgramPairsByDriveIds(driveIds),
    ]);

    const schoolIds = new Set();
    const programIds = new Set();
    data.forEach((d) => {
      const elig = d.eligibility_criteria || null;
      if (elig && Array.isArray(elig.allowed_school_ids)) elig.allowed_school_ids.forEach((id) => schoolIds.add(id));
      if (elig && Array.isArray(elig.allowed_program_ids)) elig.allowed_program_ids.forEach((id) => programIds.add(id));
      if (!elig && d.eligibility_academics?.school_id) schoolIds.add(d.eligibility_academics.school_id);
      if (!elig && d.eligibility_academics?.program_id) programIds.add(d.eligibility_academics.program_id);
    });

    const [schools, programs] = await Promise.all([
      catalogDb.getSchoolsByIds([...schoolIds]),
      catalogDb.getProgramsByIds([...programIds]),
    ]);
    programs.forEach((p) => { if (p.school_id) schoolIds.add(p.school_id); });
    const extraSchools = await catalogDb.getSchoolsByIds(
      [...schoolIds].filter((id) => !schools.some((s) => s.id === id))
    );
    const schoolMap = [...schools, ...extraSchools].reduce((acc, s) => {
      acc[s.id] = s.name;
      return acc;
    }, {});
    const programMap = programs.reduce((acc, p) => {
      acc[p.id] = p;
      return acc;
    }, {});

    const drives = data.map((d) => {
      const elig = d.eligibility_criteria || null;
      let sid = elig && Array.isArray(elig.allowed_school_ids) && elig.allowed_school_ids.length > 0
        ? elig.allowed_school_ids[0] : d.eligibility_academics?.school_id;
      const pid = elig && Array.isArray(elig.allowed_program_ids) && elig.allowed_program_ids.length > 0
        ? elig.allowed_program_ids[0] : d.eligibility_academics?.program_id;
      if (!sid && pid && programMap[pid]?.school_id) sid = programMap[pid].school_id;
      const prog = pid && programMap[pid] ? programMap[pid] : null;

      const schoolProgramPairs = pairsByDrive[d.id] || [];
      const eligibility_display = schoolProgramPairs.map((p) => `${p.school} - ${p.program}`).join(', ');

      return {
        ...d,
        process_rounds: sanitizeProcessRounds(d.process_rounds),
        company_name: d.company?.company_name ?? null,
        placement_drive_eligibility: elig || null,
        school_id: sid ?? null,
        program_id: pid ?? null,
        school: sid ? schoolMap[sid] ?? null : null,
        program: prog ? (typeof prog === 'object' ? prog.name : prog) : (pid && programMap[pid] ? programMap[pid].name : null),
        registered_count: registeredCountByDrive[d.id] ?? 0,
        school_program_pairs: schoolProgramPairs,
        eligibility_display: eligibility_display || null,
      };
    });
    const elapsed = Date.now() - routeStart;
    if (elapsed >= 500) {
      logger.info(`[placement] getAllDrives ${elapsed}ms drives=${drives.length}`);
    }
    res.json(drives);
  } catch (error) {
    logger.error('Error fetching drives:', error);
    res.json([]);
  }
};

/**
 * Derive placement_status from last_date_to_registration and event_datetime.
 * Manual-only: Cancelled, Postponed (caller should not auto-update these).
 * Upcoming: now <= last_date_to_registration (until registration deadline date/time).
 * Ongoing: last_date_to_registration < now < event_datetime.
 * Completed: now >= event_datetime.
 */
function derivePlacementStatus(lastDateToReg, eventDatetime) {
  const now = new Date();
  let regEnd = lastDateToReg ? new Date(lastDateToReg) : null;
  const eventStart = eventDatetime ? new Date(eventDatetime) : null;
  if (regEnd && !isNaN(regEnd.getTime())) {
    const str = String(lastDateToReg).trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str) || (!str.includes('T') && str.length <= 10);
    const midnight = regEnd.getHours() === 0 && regEnd.getMinutes() === 0 && regEnd.getSeconds() === 0;
    if (dateOnly || midnight) regEnd.setHours(23, 59, 59, 999);
  }
  if (!eventStart || isNaN(eventStart.getTime())) return 'Scheduled';
  if (!regEnd || isNaN(regEnd.getTime())) return now < eventStart ? 'Scheduled' : 'Completed';
  if (now <= regEnd) return 'Scheduled';
  if (now < eventStart) return 'Ongoing';
  return 'Completed';
}

/**
 * POST /placement/drives/sync-status
 * Updates placement_status for all drives based on last_date_to_registration and event_datetime.
 * Skips drives with status Cancelled or Postponed (manual).
 */
exports.syncDriveStatuses = async (req, res) => {
  try {
    const drives = await placementDb.syncDriveStatusesRows();
    const manualStatuses = ['cancelled', 'postponed'];
    let updated = 0;
    for (const d of drives) {
      const current = String(d.placement_status || '').toLowerCase();
      if (manualStatuses.includes(current)) continue;
      const newStatus = derivePlacementStatus(d.last_date_to_registration, d.event_datetime);
      if (newStatus === (d.placement_status || '')) continue;
      await placementDb.updateDriveStatus(d.id, newStatus);
      updated++;
    }
    res.json({ updated, total: drives.length });
  } catch (err) {
    logger.error('syncDriveStatuses:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * GET /placement/drives/:id
 * Returns a single placement drive by id.
 */
exports.getDriveById = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid drive id' });

    const data = await fetchPlacementsDriveByIdPg(id);
    if (!data) return res.status(404).json({ message: 'Drive not found' });

    const elig = data.eligibility_criteria || null;
    const sid = elig?.allowed_school_ids?.[0] ?? data.eligibility_academics?.school_id;
    const pid = elig?.allowed_program_ids?.[0] ?? data.eligibility_academics?.program_id;
    const [school, program] = await Promise.all([
      fetchSchoolNamePg(sid),
      fetchProgramNamePg(pid),
    ]);
    const drive = {
      ...data,
      process_rounds: sanitizeProcessRounds(data.process_rounds),
      company_name: data.company?.company_name ?? null,
      placement_drive_eligibility: elig || null,
      school_id: sid ?? null,
      program_id: pid ?? null,
      school,
      program,
    };
    res.json(drive);
  } catch (error) {
    logger.error('Error fetching drive:', error);
    res.status(500).json({ message: apiMessage(error, 'Server error') });
  }
};

/**
 * GET /placement/drives/:driveId/registrations
 * Returns student_placement_process records for a drive (for Drive Details > process list).
 * Auto-updates Pending registrations to Not Registered when deadline has passed.
 */
exports.getDriveRegistrations = async (req, res) => {
  try {
    const driveId = parseInt(req.params.driveId, 10);
    if (Number.isNaN(driveId)) return res.status(400).json({ message: 'Invalid drive ID' });

    if (req.query.usns_only === '1' || req.query.usns_only === 'true') {
      const { rows } = await pool.query(
        'SELECT usn FROM student_placement_process WHERE placement_drive_id = $1',
        [driveId]
      );
      return res.json({ usns: (rows || []).map((r) => r.usn).filter(Boolean) });
    }

    const { rows: driveMeta } = await pool.query(
      'SELECT id, job_type, process_rounds, placement_status, last_date_to_registration FROM placements_drives WHERE id = $1',
      [driveId]
    );
    const driveRow = driveMeta[0];
    if (!driveRow) return res.status(404).json({ message: 'Drive not found' });

    const deadlineStr = driveRow.last_date_to_registration;
    if (deadlineStr) {
      const deadline = new Date(deadlineStr);
      const str = String(deadlineStr).trim();
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str) || (!str.includes('T') && str.length <= 10);
      const midnight = deadline.getHours() === 0 && deadline.getMinutes() === 0 && deadline.getSeconds() === 0;
      if (dateOnly || midnight) deadline.setHours(23, 59, 59, 999);
      if (deadline < new Date()) {
        await pool.query(
          `UPDATE student_placement_process
           SET registration_status = 'Not Registered', updated_at = NOW()
           WHERE placement_drive_id = $1
             AND (registration_status = 'Pending' OR registration_status IS NULL)`,
          [driveId]
        );
      }
    }

    const { rows: processRows } = await pool.query(
      `SELECT spp.id, spp.usn, spp.placement_drive_id, spp.registration_status, spp.approved_status,
              spp.is_eligible, spp.oa_status, spp.gd_status, spp.technical_round_status,
              spp.interview_status, spp.hr_round_status, spp.final_select_status,
              spp.malpractice, spp.remarks, spp.attendance, spp.created_at, spp.updated_at,
              sbd.full_name AS student_full_name
       FROM student_placement_process spp
       LEFT JOIN student_basic_details sbd ON sbd.usn = spp.usn
       WHERE spp.placement_drive_id = $1
       ORDER BY spp.created_at DESC NULLS LAST`,
      [driveId]
    );

    const driveSnippet = {
      id: driveRow.id,
      job_type: driveRow.job_type,
      process_rounds: sanitizeProcessRounds(driveRow.process_rounds),
      placement_status: driveRow.placement_status,
    };

    let rows = (processRows || []).map((row) => {
      const { student_full_name, ...rest } = row;
      return {
        ...rest,
        student_name: student_full_name ?? null,
        student: student_full_name != null ? { usn: row.usn, full_name: student_full_name } : null,
        drive: driveSnippet,
      };
    });
    const { enrichProcessRoundDisplays } = require('../utils/placementRoundProgression');
    const processRounds = sanitizeProcessRounds(driveRow.process_rounds);
    rows = await attachDriveComplianceDetails(rows, driveId);
    rows = rows.map((row) => enrichProcessRoundDisplays(row, processRounds));
    res.json(rows);
  } catch (err) {
    logger.error('getDriveRegistrations:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * GET /placement/drives/:driveId/export
 * Returns enriched registration data for export (CSV, ZIP with resumes).
 * Query: stage=approved (only registered students), columns optional (default all).
 */
exports.getDriveExportData = async (req, res) => {
  try {
    const driveId = parseInt(req.params.driveId, 10);
    if (Number.isNaN(driveId)) return res.status(400).json({ message: 'Invalid drive ID' });

    const stage = (req.query.stage || 'approved').toLowerCase();
    const columns = req.query.columns ? String(req.query.columns).split(',').map((c) => c.trim()).filter(Boolean) : null;

    let processes = await placementDb.getExportProcessRows(driveId);
    if (stage === 'approved') {
      processes = processes.filter((p) => String(p.registration_status || '').toLowerCase() === 'registered');
    }

    const { rows: driveMetaRows } = await pool.query(
      'SELECT process_rounds FROM placements_drives WHERE id = $1',
      [driveId]
    );
    const exportProcessRounds = sanitizeProcessRounds(driveMetaRows[0]?.process_rounds);
    const { formatStatusForExport } = require('../utils/placementRoundProgression');
    processes = await attachDriveComplianceDetails(processes, driveId);

    const usns = [...new Set(processes.map((p) => p.usn).filter(Boolean))];
    if (usns.length === 0) return res.json({ data: [], columns: [] });

    const basics = await placementDb.getStudentsBasicByUsns(usns);
    const basicMap = new Map(basics.map((b) => [b.usn, b]));

    const schoolIds = [...new Set(basics.map((b) => b.school_id).filter(Boolean))];
    const programIds = [...new Set(basics.map((b) => b.program_id).filter(Boolean))];
    const majorIds = [...new Set(basics.map((b) => b.major_id).filter(Boolean))];
    const specIds = [...new Set(basics.map((b) => b.specialization_id).filter(Boolean))];

    const { schoolMap, programMap, majorMap, specMap } = await catalogDb.getNameMaps({
      schoolIds,
      programIds,
      majorIds,
      specIds,
    });

    const profiles = await placementDb.getProfilesByUsns(usns);
    const profileMap = new Map(profiles.map((p) => [p.usn, p]));

    // Fetch projects (titles) from projects table
    const projRes = await pool.query(
      'SELECT owner_usn as usn, title FROM projects WHERE owner_usn = ANY($1::text[]) ORDER BY priority ASC NULLS LAST',
      [usns]
    );
    const projects = projRes.rows || [];
    const projectByUsn = {};
    projects.forEach((p) => {
      if (!projectByUsn[p.usn]) projectByUsn[p.usn] = [];
      projectByUsn[p.usn].push(p.title || '');
    });

    const education = await placementDb.getEducationHistoryByUsns(usns);
    const eduByUsn = {};
    education.forEach((e) => {
      if (!eduByUsn[e.usn]) eduByUsn[e.usn] = [];
      eduByUsn[e.usn].push(`${e.education_level}: ${e.institute_name || ''} (${e.end_year || ''})`);
    });

    const academics = await placementDb.getAcademicsByUsns(usns);
    const acadByUsn = {};
    const seenAcad = new Set();
    academics.forEach((a) => {
      if (seenAcad.has(a.usn)) return;
      seenAcad.add(a.usn);
      if (!acadByUsn[a.usn]) {
        acadByUsn[a.usn] = { latest_sgpa: a.result_in_sgpa, live_backlogs: a.live_backlogs || 0, closed_backlogs: a.closed_backlogs || 0 };
      }
    });

    const internships = await placementDb.getInternshipsByUsns(usns);
    const intByUsn = {};
    internships.forEach((i) => {
      if (!intByUsn[i.usn]) intByUsn[i.usn] = [];
      intByUsn[i.usn].push(`${i.job_role || ''} at ${i.organization || ''} (${i.duration_months || 0}mo)`);
    });

    // Build enriched rows
    const availableColumns = [
      'usn', 'student_name', 'college_email', 'personal_email', 'phone_number', 'school', 'program', 'major', 'specialization',
      'year_of_joining', 'current_year', 'current_semester', 'section', 'gender',
      'resume_file', 'project_titles', 'education_summary', 'latest_sgpa', 'live_backlogs', 'closed_backlogs',
      'internships_summary', 'brief_summary', 'key_expertise', 'career_objective',
      'registration_status', 'approved_status', 'is_eligible',
      'oa_status', 'gd_status', 'technical_round_status', 'interview_status', 'hr_round_status', 'final_select_status',
      'malpractice', 'remarks'
    ];

    const data = processes.map((proc) => {
      const basic = basicMap.get(proc.usn) || {};
      const profile = profileMap.get(proc.usn) || {};
      const projTitles = (projectByUsn[proc.usn] || []).join('; ');
      const eduSummary = (eduByUsn[proc.usn] || []).join('; ');
      const acad = acadByUsn[proc.usn] || {};
      const intSummary = (intByUsn[proc.usn] || []).join('; ');
      const phone = [basic.phone_country_code, basic.phone_number].filter(Boolean).join(' ').trim() || null;

      return {
        usn: proc.usn,
        student_name: basic.full_name || proc.student_name || null,
        college_email: basic.college_email || null,
        personal_email: basic.personal_email || null,
        phone_number: phone || null,
        school: basic.school_id ? schoolMap.get(basic.school_id) || null : null,
        program: basic.program_id ? (programMap.get(basic.program_id)?.name ?? programMap.get(basic.program_id)) || null : null,
        major: basic.major_id ? majorMap.get(basic.major_id) || null : null,
        specialization: basic.specialization_id ? specMap.get(basic.specialization_id) || null : null,
        year_of_joining: basic.year_of_joining ?? null,
        current_year: basic.current_year ?? null,
        current_semester: basic.current_semester ?? null,
        section: basic.section || null,
        gender: basic.gender || null,
        resume_file: profile.resume_file || null,
        project_titles: projTitles || null,
        education_summary: eduSummary || null,
        latest_sgpa: acad.latest_sgpa ?? null,
        live_backlogs: acad.live_backlogs ?? null,
        closed_backlogs: acad.closed_backlogs ?? null,
        internships_summary: intSummary || null,
        brief_summary: profile.brief_summary || null,
        key_expertise: profile.key_expertise || null,
        career_objective: profile.career_objective || null,
        registration_status: formatStatusForExport(proc, 'registration_status', exportProcessRounds),
        approved_status: formatStatusForExport(proc, 'approved_status', exportProcessRounds),
        is_eligible: proc.is_eligible ?? null,
        oa_status: formatStatusForExport(proc, 'oa_status', exportProcessRounds),
        gd_status: formatStatusForExport(proc, 'gd_status', exportProcessRounds),
        technical_round_status: formatStatusForExport(proc, 'technical_round_status', exportProcessRounds),
        interview_status: formatStatusForExport(proc, 'interview_status', exportProcessRounds),
        hr_round_status: formatStatusForExport(proc, 'hr_round_status', exportProcessRounds),
        final_select_status: proc.final_select_status === true ? 'SELECTED' : proc.final_select_status === false ? 'NOT SELECTED' : 'PENDING',
        malpractice: proc.malpractice === true ? 'YES' : 'NO',
        remarks: proc.remarks || null,
      };
    });

    const outColumns = columns && columns.length > 0
      ? availableColumns.filter((c) => columns.includes(c))
      : availableColumns;

    res.json({ data, columns: outColumns, availableColumns });
  } catch (err) {
    logger.error('getDriveExportData:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * DELETE /placement/drives/:driveId/registrations/:usn
 * Remove a student from the drive's process (delete from student_placement_process).
 */
exports.removeFromProcess = async (req, res) => {
  try {
    const driveId = parseInt(req.params.driveId, 10);
    const usn = (req.params.usn || '').toString().trim();
    if (Number.isNaN(driveId) || !usn) {
      return res.status(400).json({ message: 'Invalid drive ID or USN' });
    }

    const deleted = await placementDb.deleteProcessByDriveAndUsn(driveId, usn);
    if (!deleted) {
      return res.status(404).json({ message: 'Registration not found for this drive and USN' });
    }
    res.json({ ok: true, message: 'Removed from process' });
  } catch (err) {
    logger.error('removeFromProcess:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * PATCH /placement/process/:id
 * Update a student_placement_process record (eligibility, round statuses, etc.).
 */
exports.updateProcessStatus = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'Invalid process id' });
    const body = req.body || {};

    // registration_status is updated by students only (via apply); admin cannot change it
    const allowed = [
      'is_eligible', 'approved_status',
      'oa_status', 'gd_status', 'technical_round_status', 'interview_status', 'hr_round_status',
      'final_select_status', 'malpractice', 'remarks'
    ];
    const payload = {};
    allowed.forEach((key) => {
      if (body[key] !== undefined) payload[key] = body[key];
    });

    if (!Object.keys(payload).length) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const data = await placementDb.updateProcessStatusById(id, payload);
    if (!data) return res.status(404).json({ message: 'Process record not found' });

    const driveId = data.placement_drive_id;
    const usn = data.usn;
    if (usn && driveId) {
      const processUpdateLink = `${FRONTEND_URL}/student/placements/drive/${driveId}`;
      const roundKey = Object.keys(payload).find((k) => ROUND_LABELS[k]);
      const roundLabel = roundKey ? ROUND_LABELS[roundKey] : 'Process';
      const status = (roundKey && data[roundKey] != null && data[roundKey] !== '') ? String(data[roundKey]) : 'Updated';
      getDriveForNotification(driveId).then((driveInfo) => {
        const companyName = (driveInfo && driveInfo.company_name) || 'Company';
        const eventDateStr = driveInfo && driveInfo.event_datetime
          ? formatNotificationDate(driveInfo.event_datetime)
          : 'TBD';
        const title = `${companyName} - ${roundLabel}`;
        const message = [
          `You are ${status} in the ${roundLabel}, held on ${eventDateStr}`,
          '',
          'Summary below:',
          `Round: ${roundLabel}`,
          `Status: ${status}`,
          `Event Date: ${eventDateStr}`,
        ].join('\n');
        return createAndSendToUsns(
          {
            title,
            message,
            link: processUpdateLink,
            notification_type: 'PLACEMENT',
            created_by: req.user?.id || null,
          },
          [usn]
        );
      }).catch((notifErr) => logger.warn('Process update notification failed', notifErr?.message));
    }
    res.json(data);
  } catch (err) {
    logger.error('updateProcessStatus:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * POST /placement/drives
 * Create a new placement drive.
 */
exports.addPlacementDrive = async (req, res) => {
  try {
    const body = req.body || {};
    const companyId = toInt(body.company_id);
    const eventDatetime = body.event_datetime;

    if (companyId == null) {
      return res.status(400).json({ message: 'Company is required' });
    }
    if (!eventDatetime || String(eventDatetime).trim() === '') {
      return res.status(400).json({ message: 'Event date/time is required' });
    }

    const row = {
      company_id: companyId,
      academic_year: body.academic_year || (body.year != null && body.year !== '' ? String(body.year) : null),
      year: toInt(body.year),
      job_type: body.job_type || null,
      type_of_hiring: body.type_of_hiring || null,
      job_description: body.job_description || null,
      job_location: body.job_location || null,
      ctc_structure: body.ctc_structure && typeof body.ctc_structure === 'object' ? body.ctc_structure : null,
      stipend_structure: body.stipend_structure && typeof body.stipend_structure === 'object' ? body.stipend_structure : null,
      process_rounds: Array.isArray(body.process_rounds) ? sanitizeProcessRounds(body.process_rounds) : null,
      number_of_openings: toInt(body.number_of_openings),
      number_of_registrations: toInt(body.number_of_registrations) ?? 0,
      placement_status: body.placement_status || 'Scheduled',
      last_date_to_registration: body.last_date_to_registration || null,
      event_datetime: eventDatetime || null,
      onboarded_date: body.onboarded_date || null,
      tpo: body.tpo || null,
      company_remarks: body.company_remarks || null,
    };

    let data;
    try {
      data = await placementDb.insertPlacementDrive(row);
    } catch (error) {
      logger.error('Add placement drive:', apiMessage(error, 'Failed to create drive'));
      const msg = error.code === '23503' ? 'Invalid company reference.' : apiMessage(error, 'Failed to create drive');
      return res.status(400).json({ message: msg });
    }
    res.status(201).json(data);
  } catch (err) {
    logger.error('Add placement drive:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * PUT /placement/drives/:id
 * Update a placement drive.
 */
exports.updatePlacementDrive = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'Invalid drive id' });
    const body = req.body || {};
    const companyId = toInt(body.company_id);
    const eventDatetime = body.event_datetime;

    if (companyId == null) {
      return res.status(400).json({ message: 'Company is required' });
    }
    if (!eventDatetime || String(eventDatetime).trim() === '') {
      return res.status(400).json({ message: 'Event date/time is required' });
    }

    const row = {
      company_id: companyId,
      academic_year: body.academic_year || (body.year != null && body.year !== '' ? String(body.year) : null),
      year: toInt(body.year),
      job_type: body.job_type || null,
      type_of_hiring: body.type_of_hiring || null,
      job_description: body.job_description || null,
      job_location: body.job_location || null,
      ctc_structure: body.ctc_structure && typeof body.ctc_structure === 'object' ? body.ctc_structure : null,
      stipend_structure: body.stipend_structure && typeof body.stipend_structure === 'object' ? body.stipend_structure : null,
      process_rounds: Array.isArray(body.process_rounds) ? sanitizeProcessRounds(body.process_rounds) : null,
      number_of_openings: toInt(body.number_of_openings),
      number_of_registrations: toInt(body.number_of_registrations) ?? 0,
      placement_status: body.placement_status || 'Scheduled',
      last_date_to_registration: body.last_date_to_registration || null,
      event_datetime: eventDatetime || null,
      onboarded_date: body.onboarded_date || null,
      tpo: body.tpo || null,
      company_remarks: body.company_remarks || null,
    };

    let data;
    try {
      data = await placementDb.updatePlacementDrive(id, row);
    } catch (error) {
      logger.error('Update placement drive:', apiMessage(error, 'Failed to update drive'));
      const msg = error.code === '23503' ? 'Invalid company reference.' : apiMessage(error, 'Failed to update drive');
      return res.status(400).json({ message: msg });
    }
    if (!data) return res.status(404).json({ message: 'Drive not found' });
    res.json(data);
  } catch (err) {
    logger.error('Update placement drive:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * PATCH /placement/drives/:id
 * Partial update (e.g. placement_status only). Used by process page to change status without full drive payload.
 */
exports.patchPlacementDrive = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'Invalid drive id' });
    const body = req.body || {};
    const newStatus = body.placement_status != null ? String(body.placement_status).trim() : '';
    if (!newStatus) {
      return res.status(400).json({ message: 'placement_status is required' });
    }
    const data = await placementDb.patchPlacementDrive(id, { placement_status: newStatus });
    if (!data) return res.status(404).json({ message: 'Drive not found' });
    res.json(data);
  } catch (err) {
    logger.error('Patch placement drive:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * PATCH /placement/drives/:id/status
 * Dedicated endpoint: update only placement_status in placements_drives (per database.txt schema).
 * Body: { "placement_status": "Scheduled" | "Ongoing" | "Completed" | "Failed" | "Postponed" | ... }
 */
exports.updatePlacementDriveStatusOnly = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid drive id' });
    }
    const body = req.body || {};
    const placement_status = body.placement_status != null ? String(body.placement_status).trim() : '';
    if (!placement_status) {
      return res.status(400).json({ message: 'placement_status is required' });
    }
    const data = await placementDb.patchPlacementDrive(id, { placement_status });
    if (!data) {
      return res.status(404).json({ message: 'Drive not found' });
    }
    res.json({ id: data.id, placement_status: data.placement_status, updated_at: data.updated_at });
  } catch (err) {
    logger.error('Update placement drive status:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * GET /placement/drives/:driveId/eligibility
 * Returns eligibility_criteria for a drive (from placements_drives).
 */
exports.getDriveEligibility = async (req, res) => {
  try {
    const driveId = parseInt(req.params.driveId, 10);
    if (Number.isNaN(driveId)) return res.status(400).json({ message: 'Invalid drive ID' });

    const { rows } = await pool.query(
      'SELECT eligibility_criteria FROM placements_drives WHERE id = $1',
      [driveId]
    );
    res.json(rows[0]?.eligibility_criteria ?? null);
  } catch (err) {
    logger.error('getDriveEligibility:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * PUT /placement/drives/:driveId/eligibility
 * Upsert eligibility_criteria on placements_drives for a drive.
 */
exports.upsertDriveEligibility = async (req, res) => {
  try {
    const driveId = parseInt(req.params.driveId, 10);
    if (Number.isNaN(driveId)) return res.status(400).json({ message: 'Invalid drive ID' });
    const body = req.body || {};

    const toArray = (v) => {
      if (v == null) return null;
      if (Array.isArray(v)) return v.filter((x) => x != null && x !== '');
      if (typeof v === 'number' || typeof v === 'string') return [v];
      return null;
    };
    const toIntArray = (v) => {
      const arr = toArray(v);
      if (!arr) return null;
      return arr.map((x) => (typeof x === 'number' ? x : parseInt(x, 10))).filter((n) => !Number.isNaN(n));
    };

    const eligibilityCriteria = {
      min_cgpa: body.min_cgpa != null && body.min_cgpa !== '' ? parseFloat(body.min_cgpa) : null,
      max_cgpa: body.max_cgpa != null && body.max_cgpa !== '' ? parseFloat(body.max_cgpa) : null,
      max_active_backlogs: body.max_active_backlogs != null && body.max_active_backlogs !== '' ? parseInt(body.max_active_backlogs, 10) : null,
      max_backlog_history: body.max_backlog_history != null && body.max_backlog_history !== '' ? parseInt(body.max_backlog_history, 10) : null,
      eligible_years: toIntArray(body.eligible_years),
      eligible_semesters: toIntArray(body.eligible_semesters),
      allowed_school_ids: toIntArray(body.allowed_school_ids),
      allowed_program_ids: toIntArray(body.allowed_program_ids),
      allowed_major_ids: toIntArray(body.allowed_major_ids),
      allowed_specialization_ids: toIntArray(body.allowed_specialization_ids),
      joining_years: toIntArray(body.joining_years),
      graduation_years: toIntArray(body.graduation_years),
      allow_already_placed: body.allow_already_placed !== false,
      max_existing_ctc_lpa: body.max_existing_ctc_lpa != null && body.max_existing_ctc_lpa !== '' ? parseFloat(body.max_existing_ctc_lpa) : null,
      min_new_ctc_lpa: body.min_new_ctc_lpa != null && body.min_new_ctc_lpa !== '' ? parseFloat(body.min_new_ctc_lpa) : null,
      min_ctc_multiplier: body.min_ctc_multiplier != null && body.min_ctc_multiplier !== '' ? parseFloat(body.min_ctc_multiplier) : null,
      count_offcampus_offers: body.count_offcampus_offers !== false,
      admin_override_allowed: body.admin_override_allowed === true,
      max_total_offers: body.max_total_offers != null && body.max_total_offers !== '' ? parseInt(body.max_total_offers, 10) : null,
    };
    Object.keys(eligibilityCriteria).forEach((k) => { if (eligibilityCriteria[k] === undefined) delete eligibilityCriteria[k]; });

    const updated = await placementDb.updateDriveEligibilityCriteria(driveId, eligibilityCriteria);
    if (!updated) return res.status(404).json({ message: 'Drive not found' });
    const result = { ...updated, ...eligibilityCriteria };

    // Add all eligible students to this drive's process
    try {
      const schoolIds = result.allowed_school_ids && result.allowed_school_ids.length ? result.allowed_school_ids : null;
      const programIds = result.allowed_program_ids && result.allowed_program_ids.length ? result.allowed_program_ids : null;

      const where = ['s.opt_in = true'];
      const params = [];
      let idx = 1;
      if (schoolIds && schoolIds.length) {
        where.push(`s.school_id = ANY($${idx})`);
        params.push(schoolIds);
        idx += 1;
      }
      if (programIds && programIds.length) {
        where.push(`s.program_id = ANY($${idx})`);
        params.push(programIds);
        idx += 1;
      }
      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const eligibleRes = await pool.query(
        `
          SELECT s.usn
          FROM student_basic_details s
          JOIN user_login ul
            ON ul.usn = s.usn
          ${whereClause}
            AND ul.is_active = true
          ORDER BY s.usn ASC
          LIMIT 10000
        `,
        params
      );
      const eligibleUsns = (eligibleRes.rows || []).map((r) => r.usn).filter(Boolean);
      if (eligibleUsns.length === 0) {
        return res.json({ ...result, addedToProcess: 0 });
      }

      const existingUsns = await placementDb.getExistingProcessUsns(driveId);
      const existingSet = new Set(existingUsns);
      const toAdd = eligibleUsns.filter((u) => !existingSet.has(u));
      const processRows = toAdd.map((usn) => ({
        usn,
        placement_drive_id: driveId,
        is_eligible: true,
        registration_status: 'Pending',
      }));

      if (processRows.length > 0) {
        try {
          await placementDb.insertProcessBatch(processRows);
        } catch (procErr) {
          logger.warn('Eligibility: add to process batch error', procErr?.message);
        }
        const driveRegistrationLink = `${FRONTEND_URL}/student/placements/drive/${driveId}`;
        getDriveForNotification(driveId).then((driveInfo) => {
          const title = (driveInfo && driveInfo.company_name) || 'Placement drive';
          const desc = (driveInfo && driveInfo.job_description) || 'You have been added to a placement drive.';
          const deadlineStr = driveInfo && driveInfo.last_date_to_registration
            ? formatNotificationDate(driveInfo.last_date_to_registration)
            : 'TBD';
          const message = `${desc}\n\nRegistration deadline: ${deadlineStr}`;
          return createAndSendToUsns(
            {
              title,
              message,
              link: driveRegistrationLink,
              notification_type: 'PLACEMENT',
              created_by: req.user?.id || null,
            },
            toAdd
          );
        }).catch((notifErr) => logger.warn('Eligibility: drive registration notification failed', notifErr?.message));
      }

      return res.json({
        ...result,
        addedToProcess: processRows.length,
      });
    } catch (postErr) {
      logger.warn('Eligibility: add students failed', postErr?.message);
      res.json(result);
    }
  } catch (err) {
    logger.error('upsertDriveEligibility:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * GET /placement/dashboard-stats
 * Returns summary counts for the admin dashboard: total_registered, total_seeking, total_eligible.
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const headline = await dashboardDb.getStudentHeadlineCounts();
    res.json({
      total_registered: headline.total_registered,
      total_seeking: headline.total_seeking,
      total_eligible: headline.total_eligible,
    });
  } catch (err) {
    logger.error('getDashboardStats:', err);
    res.status(500).json({ message: 'Server error fetching dashboard stats' });
  }
};

/**
 * GET /placement/dashboard/analytics
 * Full placement dashboard metrics aggregated in PostgreSQL (no paginated student fetch).
 */
exports.getDashboardAnalytics = async (req, res) => {
  try {
    const data = await dashboardDb.getDashboardAnalytics();
    res.json(data);
  } catch (err) {
    logger.error('getDashboardAnalytics:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error fetching dashboard analytics') });
  }
};

function parseQueryIntList(str) {
  if (!str || typeof str !== 'string') return null;
  const nums = str.split(/[\s,]+/).map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n));
  return nums.length ? nums : null;
}

function parseQueryFloat(str) {
  if (str == null || str === '') return null;
  const n = parseFloat(str);
  return Number.isNaN(n) ? null : n;
}

/**
 * GET /placement/students
 * Returns list of students for "Add Students to Drive" (admin).
 * Query: school_id, school_ids, program_id, program_ids, search, limit, page, page_size, opt_in_only, drive_id, filters...
 * Paginated (page + page_size): { students, total, page, pageSize, totalPages }
 * Legacy (no page): array of students
 */
exports.getStudentsForPlacement = async (req, res) => {
  const startTime = Date.now();
  try {
    const driveId = req.query.drive_id ? parseInt(req.query.drive_id, 10) : null;
    const driveIdValid = driveId != null && !Number.isNaN(driveId);
    const pageRaw = parseInt(req.query.page, 10);
    const page = !Number.isNaN(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
    const requestedSize = parseInt(req.query.page_size, 10) || parseInt(req.query.limit, 10) || 50;
    const pageSize = Math.min(100, Math.max(1, requestedSize));
    const offset = (page - 1) * pageSize;

    const search = (req.query.search || '').trim();
    const schoolId = req.query.school_id ? parseInt(req.query.school_id, 10) : null;
    const programId = req.query.program_id ? parseInt(req.query.program_id, 10) : null;
    const schoolIds = parseQueryIntList(req.query.school_ids);
    const programIds = parseQueryIntList(req.query.program_ids);
    const specializationIds = parseQueryIntList(req.query.specialization_ids);
    const majorIds = parseQueryIntList(req.query.major_ids);
    const joiningYears = parseQueryIntList(req.query.joining_years);
    const graduationYears = parseQueryIntList(req.query.graduation_years);
    const minCgpa = parseQueryFloat(req.query.min_cgpa);
    const maxCgpa = parseQueryFloat(req.query.max_cgpa);
    const maxActiveBacklogs = req.query.max_backlogs != null && req.query.max_backlogs !== ''
      ? parseInt(req.query.max_backlogs, 10) : null;
    const maxBacklogHistory = req.query.max_backlog_history != null && req.query.max_backlog_history !== ''
      ? parseInt(req.query.max_backlog_history, 10) : null;

    const optedInOnly =
      req.query.opt_in_only === '0' || req.query.opt_in_only === 'false'
        ? false
        : req.query.opt_in_only === '1' ||
          req.query.opt_in_only === 'true' ||
          driveIdValid;
    const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
    const includeAcademics = driveIdValid;

    // Default: exclude students with active violations/disciplinary records (opt out with =0 or include_*=1)
    const excludePlacementViolations =
      req.query.include_placement_violations === '1' || req.query.include_placement_violations === 'true'
        ? false
        : req.query.exclude_placement_violations !== '0' && req.query.exclude_placement_violations !== 'false';
    const excludeDisciplinaryRecords =
      req.query.include_disciplinary_records === '1' || req.query.include_disciplinary_records === 'true'
        ? false
        : req.query.exclude_disciplinary_records !== '0' && req.query.exclude_disciplinary_records !== 'false';
    const excludeAdminHold = req.query.exclude_admin_hold === '1' || req.query.exclude_admin_hold === 'true';
    const excludeAdminOverrideHold = req.query.exclude_admin_override_hold === '1' || req.query.exclude_admin_override_hold === 'true';
    const excludeAlreadyAdded = req.query.exclude_already_added === '1' || req.query.exclude_already_added === 'true';

    const values = [];
    if (driveIdValid) values.push(driveId);
    const driveIdIdx = driveIdValid ? values.length : null;

    const academicsSource = await resolveAcademicsTableSource();
    const academicsTable = academicsSource === 'legacy' ? 'student_semester_academics' : 'student_semester_records';
    const latestSgpaExpr = academicsSource === 'legacy' ? 'result_in_sgpa' : 'COALESCE(cgpa, sgpa)';
    const liveBacklogsExpr = academicsSource === 'legacy' ? 'COALESCE(live_backlogs, 0)' : 'COALESCE(active_backlogs, 0)';
    const closedBacklogsExpr = academicsSource === 'legacy' ? 'closed_backlogs' : 'cleared_backlogs';
    const needsAcademicsLateral =
      includeAcademics
      || minCgpa != null
      || maxCgpa != null
      || (maxActiveBacklogs != null && !Number.isNaN(maxActiveBacklogs))
      || (maxBacklogHistory != null && !Number.isNaN(maxBacklogHistory));

    let academicsJoinSql = '';
    if (needsAcademicsLateral) {
      academicsJoinSql = `
      LEFT JOIN LATERAL (
        SELECT (${latestSgpaExpr})::float AS latest_sgpa,
               (${liveBacklogsExpr})::int AS live_backlogs,
               (${closedBacklogsExpr})::int AS closed_backlogs
        FROM public.${academicsTable} r
        WHERE r.usn = s.usn
        ORDER BY r.academic_year DESC NULLS LAST, r.semester DESC NULLS LAST
        LIMIT 1
      ) ac ON true`;
    }

    const fromClause = `
      FROM student_basic_details s
      LEFT JOIN schools sch ON s.school_id = sch.id
      LEFT JOIN programs prg ON s.program_id = prg.id
      LEFT JOIN majors maj ON s.major_id = maj.id
      LEFT JOIN specializations spc ON s.specialization_id = spc.id
      LEFT JOIN student_edit_control sec ON s.usn = sec.usn${academicsJoinSql}`;

    const inactiveJoinSql = !includeInactive
      ? ' INNER JOIN user_login ul ON ul.usn = s.usn AND ul.is_active = true'
      : '';

    const whereParts = ['TRUE'];
    if (driveIdValid) {
      whereParts.push(`($${driveIdIdx} = $${driveIdIdx})`);
    }
    if (optedInOnly) whereParts.push('s.opt_in = true');
    if (excludeAlreadyAdded && driveIdValid) {
      whereParts.push(`NOT EXISTS (SELECT 1 FROM student_placement_process spp WHERE spp.usn = s.usn AND spp.placement_drive_id = $${driveIdIdx})`);
    }
    if (schoolIds?.length) {
      whereParts.push(`s.school_id = ANY($${values.length + 1})`);
      values.push(schoolIds);
    } else if (schoolId != null) {
      whereParts.push(`s.school_id = $${values.length + 1}`);
      values.push(schoolId);
    }
    if (programIds?.length) {
      whereParts.push(`s.program_id = ANY($${values.length + 1})`);
      values.push(programIds);
    } else if (programId != null) {
      whereParts.push(`s.program_id = $${values.length + 1}`);
      values.push(programId);
    }
    if (search) {
      whereParts.push(`(s.usn ILIKE $${values.length + 1} OR s.full_name ILIKE $${values.length + 1} OR s.college_email ILIKE $${values.length + 1} OR s.personal_email ILIKE $${values.length + 1})`);
      values.push(`%${search}%`);
    }
    if (specializationIds?.length) {
      whereParts.push(`s.specialization_id = ANY($${values.length + 1})`);
      values.push(specializationIds);
    }
    if (majorIds?.length) {
      whereParts.push(`s.major_id = ANY($${values.length + 1})`);
      values.push(majorIds);
    }
    if (joiningYears?.length) {
      whereParts.push(`s.year_of_joining = ANY($${values.length + 1})`);
      values.push(joiningYears);
    }
    if (graduationYears?.length) {
      whereParts.push(`(s.year_of_joining + COALESCE(prg.max_duration_years, 4)) = ANY($${values.length + 1})`);
      values.push(graduationYears);
    }
    if (minCgpa != null) {
      if (needsAcademicsLateral) {
        whereParts.push(`ac.latest_sgpa IS NOT NULL AND ac.latest_sgpa >= $${values.length + 1}`);
      } else {
        whereParts.push(`EXISTS (SELECT 1 FROM public.${academicsTable} r WHERE r.usn = s.usn AND (${latestSgpaExpr})::float >= $${values.length + 1})`);
      }
      values.push(minCgpa);
    }
    if (maxCgpa != null) {
      if (needsAcademicsLateral) {
        whereParts.push(`ac.latest_sgpa IS NOT NULL AND ac.latest_sgpa <= $${values.length + 1}`);
      } else {
        whereParts.push(`EXISTS (SELECT 1 FROM public.${academicsTable} r WHERE r.usn = s.usn AND (${latestSgpaExpr})::float <= $${values.length + 1})`);
      }
      values.push(maxCgpa);
    }
    if (maxActiveBacklogs != null && !Number.isNaN(maxActiveBacklogs)) {
      if (needsAcademicsLateral) {
        whereParts.push(`COALESCE(ac.live_backlogs, 0) <= $${values.length + 1}`);
      } else {
        whereParts.push(`EXISTS (SELECT 1 FROM public.${academicsTable} r WHERE r.usn = s.usn AND (${liveBacklogsExpr}) <= $${values.length + 1})`);
      }
      values.push(maxActiveBacklogs);
    }
    if (maxBacklogHistory != null && !Number.isNaN(maxBacklogHistory)) {
      whereParts.push(`(SELECT COALESCE(SUM(${closedBacklogsExpr}), 0)::int FROM public.${academicsTable} r WHERE r.usn = s.usn) <= $${values.length + 1}`);
      values.push(maxBacklogHistory);
    }
    if (excludeAdminHold && driveIdValid) {
      whereParts.push(`NOT EXISTS (SELECT 1 FROM eligibility_decision_logs edl WHERE edl.usn = s.usn AND edl.placement_drive_id = $${driveIdIdx} AND edl.is_eligible = false)`);
    }
    if (excludePlacementViolations) {
      whereParts.push('NOT EXISTS (SELECT 1 FROM student_placement_violations spv WHERE spv.usn = s.usn AND spv.is_active = true)');
    }
    if (excludeDisciplinaryRecords) {
      whereParts.push('NOT EXISTS (SELECT 1 FROM student_disciplinary_records sdr WHERE sdr.usn = s.usn AND sdr.is_active = true)');
    }
    if (excludeAdminOverrideHold) {
      whereParts.push('COALESCE(sec.is_placements_locked, false) = false');
      if (driveIdValid) {
        whereParts.push(`NOT EXISTS (SELECT 1 FROM eligibility_decision_logs edl WHERE edl.usn = s.usn AND edl.placement_drive_id = $${driveIdIdx})`);
      }
    }

    const whereClause = `WHERE ${whereParts.join(' AND ')}`;
    const countSql = `SELECT COUNT(*)::int AS total ${fromClause}${inactiveJoinSql} ${whereClause}`;
    const countStart = Date.now();
    const { rows: countRows } = await pool.query(countSql, values);
    const total = countRows[0]?.total ?? 0;
    console.log(`[getStudentsForPlacement] Count finished. total=${total}, time=${Date.now() - countStart}ms`);

    const inProcessCol = driveIdValid
      ? `, EXISTS(SELECT 1 FROM student_placement_process spp WHERE spp.usn = s.usn AND spp.placement_drive_id = $${driveIdIdx}) AS is_in_process`
      : '';
    const acadSelectCols = needsAcademicsLateral
      ? ', ac.latest_sgpa, ac.live_backlogs, ac.closed_backlogs'
      : '';
    const selectCols = `s.usn, s.full_name, s.college_email, s.personal_email, s.school_id, s.program_id, s.major_id, s.specialization_id,
        s.year_of_joining, s.current_year, s.current_semester, s.section, s.gender, s.opt_in, s.is_placement_eligible,
        sch.name AS school_name,
        prg.name AS program_name, prg.max_duration_years,
        maj.name AS major_name,
        spc.name AS specialization_name,
        COALESCE(sec.is_placements_locked, false) AS admin_hold${inProcessCol}${acadSelectCols}`;

    let sql = `SELECT ${selectCols} ${fromClause}${inactiveJoinSql} ${whereClause}`;
    const queryValues = [...values];
    sql += ` ORDER BY s.usn ASC LIMIT $${queryValues.length + 1} OFFSET $${queryValues.length + 2}`;
    queryValues.push(pageSize, offset);

    const fetchStart = Date.now();
    const { rows } = await pool.query(sql, queryValues);
    console.log(`[getStudentsForPlacement] Fetch finished. rows=${rows.length}, time=${Date.now() - fetchStart}ms`);

    let list = rows.map((s) => {
      const maxYears = s.max_duration_years ?? 4;
      const gradYear = s.year_of_joining != null ? s.year_of_joining + maxYears : null;
      return {
        usn: s.usn,
        full_name: s.full_name,
        name: s.full_name,
        college_email: s.college_email,
        personal_email: s.personal_email,
        email: s.college_email || s.personal_email,
        school_id: s.school_id,
        program_id: s.program_id,
        major_id: s.major_id,
        specialization_id: s.specialization_id,
        school: s.school_name ?? null,
        program: s.program_name ?? null,
        major: s.major_name ?? null,
        specialization: s.specialization_name ?? null,
        year_of_joining: s.year_of_joining,
        graduation_year: gradYear,
        current_year: s.current_year,
        current_semester: s.current_semester,
        section: s.section,
        gender: s.gender,
        opt_in: s.opt_in,
        is_placement_eligible: s.is_placement_eligible,
        admin_hold: s.admin_hold,
        is_in_process: s.is_in_process ?? false
      };
    });

    if (includeAcademics && list.length > 0) {
      const usns = list.map((s) => s.usn).filter(Boolean);
      if (!needsAcademicsLateral) {
        const academicsMap = await getStudentAcademicsMap(usns);
        list = list.map((s) => {
          const ac = academicsMap.get(s.usn) || {};
          return {
            ...s,
            latest_sgpa: ac.latest_sgpa ?? null,
            live_backlogs: ac.live_backlogs ?? 0,
            closed_backlogs: ac.closed_backlogs ?? 0,
            total_backlog_history: ac.total_backlog_history ?? 0,
          };
        });
      } else {
        list = list.map((s) => ({
          ...s,
          latest_sgpa: s.latest_sgpa != null ? parseFloat(s.latest_sgpa) : null,
          live_backlogs: s.live_backlogs != null ? parseInt(s.live_backlogs, 10) : 0,
          closed_backlogs: s.closed_backlogs != null ? parseInt(s.closed_backlogs, 10) : 0,
          total_backlog_history: s.closed_backlogs != null ? parseInt(s.closed_backlogs, 10) : 0,
        }));
      }

      if (driveId) {
        const { rows: eligRows } = await pool.query(
          'SELECT eligibility_criteria FROM placements_drives WHERE id = $1',
          [driveId]
        );
        const elig = eligRows[0]?.eligibility_criteria || null;
        // Annotate eligibility for display only — never remove rows from the response
        if (elig) {
          list = list.map((s) => {
            const { isEligible, rejectionReasons } = evaluateEligibility(s, elig);
            return { ...s, is_eligible: isEligible, rejection_reasons: rejectionReasons };
          });
        }

        // Apply manual overrides from eligibility_decision_logs
        try {
          const logMap = new Map();
          for (const chunk of chunkArray(usns)) {
            const { rows: logRows } = await pool.query(
              `SELECT usn, is_eligible, rejection_reasons
               FROM eligibility_decision_logs
               WHERE placement_drive_id = $1 AND usn = ANY($2::text[])`,
              [driveId, chunk]
            );
            (logRows || []).forEach((row) => logMap.set(row.usn, row));
          }

          list = list.map((s) => {
            const log = logMap.get(s.usn);
            // Result: YES if (locked in student_edit_control) OR (exists in eligibility_decision_logs)
            const hasManualLog = !!log;
            if (hasManualLog) {
              return {
                ...s,
                is_eligible: log.is_eligible,
                rejection_reasons: log.is_eligible ? [] : (log.rejection_reasons || ['Manual admin override']),
                is_manual_override: true,
                admin_hold: true 
              };
            }
            return s;
          });
        } catch (logErr) {
          logger.warn('getStudentsForPlacement: eligibility_decision_logs', logErr.message);
        }

        list = await attachPlacementStats(list, usns);
      }
    }

    return res.json({
      students: list,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (err) {
    logger.error('getStudentsForPlacement:', err);
    res.status(500).json({ message: 'Server error fetching students' });
  }
};

/**
 * GET /placement/students/overview-table
 * Returns per-student placement overview (opted-in only): name, usn, email, school, program,
 * drives eligible/applied, OA passed, round counts, offers, internship offers, accepted,
 * max CTC, max stipend, absent, placement violations, disciplinary, admin hold, malpractice.
 * Query: search, limit, school (comma-separated names), program (comma-separated names).
 */
exports.getStudentsOverviewTable = async (req, res) => {
  try {
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const schoolParam = (req.query.school || '').trim();
    const programParam = (req.query.program || '').trim();

    const schoolsList = await catalogDb.getAllSchools();

    let schoolIds = null;
    let programIds = null;
    if (schoolParam) {
      const schoolNames = schoolParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (schoolNames.length > 0) {
        const schoolRows = await catalogDb.getSchoolsByNames(schoolNames);
        schoolIds = schoolRows.map((r) => r.id).filter(Boolean);
      }
    }
    if (programParam) {
      const programNames = programParam.split(',').map((p) => p.trim()).filter(Boolean);
      if (programNames.length > 0) {
        const programRows = await catalogDb.getProgramsByNames(programNames);
        programIds = programRows.map((r) => r.id).filter(Boolean);
      }
    }

    const { students: studentList, total: totalCount } = await placementDb.fetchOverviewStudentsPage({
      limit,
      offset,
      search: search || null,
      schoolIds: schoolIds?.length ? schoolIds : null,
      programIds: programIds?.length ? programIds : null,
    });

    const roundColumns = [
      { id: 'oa_passed', label: 'OA passed' },
      { id: 'gd_passed', label: 'GD passed' },
      { id: 'technical_passed', label: 'Technical passed' },
      { id: 'interview_passed', label: 'Interview passed' },
      { id: 'hr_passed', label: 'HR passed' },
      { id: 'final_select_passed', label: 'Final select passed' },
    ];

    if (studentList.length === 0) {
      return res.json({
        rows: [],
        roundColumns,
        schoolsList: schoolsList || [],
        total: totalCount ?? 0,
        page,
        limit,
      });
    }

    const usns = studentList.map((s) => s.usn).filter(Boolean);
    const usnSet = new Set(usns);

    const {
      processes: processList,
      offers: offersList,
      placements: placementList,
      capstones: capstoneList,
      violations,
      disciplinary,
      editLocks,
    } = await placementDb.getOverviewStatsForUsns(usns);
    const violationList = [...violations].map((usn) => ({ usn }));
    const disciplinaryList = [...disciplinary].map((usn) => ({ usn }));
    const lockList = [...editLocks.entries()].map(([usn, is_placements_locked]) => ({
      usn,
      is_placements_locked,
    }));

    const perUsn = {};
    usns.forEach((u) => {
      perUsn[u] = {
        drives_eligible: 0,
        drives_applied: 0,
        oas_passed: 0,
        gd_passed: 0,
        technical_passed: 0,
        interview_passed: 0,
        hr_passed: 0,
        final_select_passed: 0,
        drives_absent: 0,
        malpractice_count: 0,
        placement_violations: 0,
        disciplinary: 0,
        admin_hold: false,
        offers_count: 0,
        internship_offers: 0,
        offer_accepted: false,
        max_ctc_lpa: null,
        max_stipend: null,
      };
    });

    processList.forEach((p) => {
      if (!usnSet.has(p.usn)) return;
      const o = perUsn[p.usn];
      if (p.is_eligible === true) o.drives_eligible += 1;
      if (String(p.registration_status || '').toLowerCase() === 'registered') o.drives_applied += 1;
      if (p.oa_status === true) o.oas_passed += 1;
      if (p.gd_status === true) o.gd_passed += 1;
      if (p.technical_round_status === true) o.technical_passed += 1;
      if (p.interview_status === true) o.interview_passed += 1;
      if (p.hr_round_status === true) o.hr_passed += 1;
      if (p.final_select_status === true) o.final_select_passed += 1;
      if (String(p.attendance || '').toLowerCase() === 'absent') o.drives_absent += 1;
      if (p.malpractice === true) o.malpractice_count += 1;
    });

    violationList.forEach((v) => {
      if (perUsn[v.usn]) perUsn[v.usn].placement_violations += 1;
    });
    disciplinaryList.forEach((d) => {
      if (perUsn[d.usn]) perUsn[d.usn].disciplinary += 1;
    });
    lockList.forEach((l) => {
      if (perUsn[l.usn]) perUsn[l.usn].admin_hold = l.is_placements_locked === true;
    });

    const placementByStudent = {};
    placementList.forEach((pl) => {
      if (!placementByStudent[pl.student_id]) placementByStudent[pl.student_id] = [];
      placementByStudent[pl.student_id].push(pl);
    });
    const capstoneByStudent = {};
    capstoneList.forEach((c) => {
      if (!capstoneByStudent[c.usn]) capstoneByStudent[c.usn] = [];
      capstoneByStudent[c.usn].push(c);
    });

    offersList.forEach((off) => {
      if (!perUsn[off.student_id]) return;
      const o = perUsn[off.student_id];
      o.offers_count += 1;
      const jt = String(off.job_type || '').toLowerCase();
      if (jt.includes('internship') || jt.includes('capstone') || off.capstone_id) o.internship_offers += 1;
      if (off.is_accepted === true) o.offer_accepted = true;
    });

    Object.keys(placementByStudent).forEach((sid) => {
      const o = perUsn[sid];
      if (!o) return;
      placementByStudent[sid].forEach((pl) => {
        const ctc = pl.ctc_max_lpa != null ? pl.ctc_max_lpa : pl.ctc_min_lpa;
        if (ctc != null && (o.max_ctc_lpa == null || ctc > o.max_ctc_lpa)) o.max_ctc_lpa = Number(ctc);
      });
    });
    Object.keys(capstoneByStudent).forEach((sid) => {
      const o = perUsn[sid];
      if (!o) return;
      capstoneByStudent[sid].forEach((cap) => {
        const stip = cap.internship_stipend_max != null ? cap.internship_stipend_max : cap.internship_stipend_min;
        if (stip != null && (o.max_stipend == null || stip > o.max_stipend)) o.max_stipend = Number(stip);
      });
    });

    const rows = studentList
      .map((s) => {
        const agg = perUsn[s.usn] || {};
        return {
          usn: s.usn,
          full_name: s.full_name,
          college_email: s.college_email,
          school: s.school_name || null,
          program: s.program_name || null,
          drives_eligible: agg.drives_eligible ?? 0,
          drives_applied: agg.drives_applied ?? 0,
          oas_passed: agg.oas_passed ?? 0,
          gd_passed: agg.gd_passed ?? 0,
          technical_passed: agg.technical_passed ?? 0,
          interview_passed: agg.interview_passed ?? 0,
          hr_passed: agg.hr_passed ?? 0,
          final_select_passed: agg.final_select_passed ?? 0,
          offers_count: agg.offers_count ?? 0,
          internship_offers: agg.internship_offers ?? 0,
          offer_accepted: agg.offer_accepted === true,
          max_ctc_lpa: agg.max_ctc_lpa != null ? agg.max_ctc_lpa : null,
          max_stipend: agg.max_stipend != null ? agg.max_stipend : null,
          drives_absent: agg.drives_absent ?? 0,
          placement_violations: agg.placement_violations ?? 0,
          disciplinary: agg.disciplinary ?? 0,
          admin_hold: agg.admin_hold === true,
          malpractice: agg.malpractice_count ?? 0,
        };
      });

    res.json({ 
      rows, 
      roundColumns, 
      schoolsList: schoolsList || [],
      total: totalCount || 0,
      page,
      limit
    });
  } catch (err) {
    logger.error('getStudentsOverviewTable:', err);
    res.status(500).json({ message: 'Server error fetching students overview table' });
  }
};

/**
 * GET /placement/companies
 * Returns companies with optional school_id filter.
 * Query: school_id (optional) - filter to companies that have drives with students from this school.
 * Response: { companies, schoolsList } - schoolsList = [{ id, name, count }] for filter UI.
 * Logic: companies -> placements_drives -> student_placement_process -> student_basic_details.school_id
 */
exports.getAllCompanies = async (req, res) => {
  try {
    const schoolIdParam = req.query.school_id;
    const schoolId = schoolIdParam ? parseInt(schoolIdParam, 10) : null;
    const filterBySchool = schoolId != null && !Number.isNaN(schoolId);
    const result = await placementDb.getCompaniesList(filterBySchool ? schoolId : null);
    res.json(result);
  } catch (error) {
    logger.error('Error fetching companies:', error);
    res.status(500).json({ companies: [], schoolsList: [], totalCompanies: 0 });
  }
};

/**
 * GET /placement/companies/:id
 * Returns a single company by id.
 */
exports.getCompanyById = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid company id' });

    const data = await placementDb.getCompanyById(id);
    if (!data) return res.status(404).json({ message: 'Company not found' });
    res.json(data);
  } catch (error) {
    logger.error('Error fetching company:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /placement/companies/:id/drives
 * Returns placement drives for a company.
 */
exports.getCompanyDrives = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid company id' });

    const data = await placementDb.getCompanyDrives(id);
    const drives = data.map((d) => {
      const ctc = d.ctc_structure && typeof d.ctc_structure === 'object'
        ? (d.ctc_structure.min_lpa != null || d.ctc_structure.max_lpa != null)
          ? [d.ctc_structure.min_lpa, d.ctc_structure.max_lpa].filter(Boolean).join('–')
          : null
        : null;
      const stipend = d.stipend_structure && typeof d.stipend_structure === 'object'
        ? (d.stipend_structure.min != null || d.stipend_structure.max != null)
          ? [d.stipend_structure.min, d.stipend_structure.max].filter(Boolean).join('–')
          : null
        : null;
      return {
        id: d.id,
        tpo: d.tpo || '-',
        year: d.academic_year || d.year || '-',
        school: '-',
        course: '-',
        job_profile: d.job_description || '-',
        job_type: d.job_type || '-',
        internship_stipend: stipend || '-',
        ctc: ctc || '-',
        no_shortlisted: d.number_of_registrations ?? d.number_of_openings ?? '-',
        company_remarks: d.company_remarks || '-',
      };
    });
    res.json(drives);
  } catch (error) {
    logger.error('Error fetching company drives:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /placement/companies/:id/offers
 * Returns placement records (students & offers) for a company.
 */
exports.getCompanyOffers = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid company id' });

    const placements = await placementDb.getCompanyPlacements(id);
    const offers = placements.map((p) => {
      const ctc = [p.ctc_min_lpa, p.ctc_max_lpa].filter((x) => x != null);
      const ctcStr = ctc.length ? ctc.join('–') : '-';
      return {
        id: p.id,
        usn: p.student_id,
        student_name: p.full_name || null,
        school: p.school_name || '-',
        ctc: ctcStr,
        job_type: p.type_of_hiring || '-',
        designation: p.designation || '-',
        offer_letter_status: p.offer_letter_status || '-',
      };
    });
    res.json(offers);
  } catch (error) {
    logger.error('Error fetching company offers:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /placement/companies
 * Create a new company. Body: company_name, description, company_type, address, website, linkedin, remarks, company_logo_link.
 * Optional: contacts (array of { contact_name, email, phone_number, role_title, remarks }) to add after creation.
 */
exports.addCompany = async (req, res) => {
  try {
    const body = req.body || {};
    const company_name = body.company_name || body.name;
    if (!company_name || typeof company_name !== 'string' || !company_name.trim()) {
      return res.status(400).json({ message: 'company_name is required' });
    }

    let remarks = body.remarks;
    if (remarks != null && !Array.isArray(remarks)) {
      remarks = typeof remarks === 'string' ? (remarks ? [remarks] : []) : [String(remarks)];
    } else if (remarks == null) {
      remarks = [];
    }
    const payload = {
      company_name: String(company_name).trim(),
      description: body.description || null,
      company_type: body.company_type || body.industry || null,
      address: body.address || null,
      website: body.website || null,
      linkedin: body.linkedin || null,
      remarks: remarks.length ? remarks : null,
      company_logo_link: body.company_logo_link || body.logo || null,
    };

    let data;
    try {
      data = await placementDb.insertCompany(payload);
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ message: 'Company with this name already exists' });
      throw error;
    }

    const contacts = Array.isArray(body.contacts) ? body.contacts : [];
    if (contacts.length > 0 && data.id) {
      const contactRows = contacts
        .filter((c) => c && (c.contact_name || c.email || c.phone_number))
        .map((c) => ({
          company_id: data.id,
          contact_name: c.contact_name || null,
          email: c.email || null,
          phone_number: c.phone_number || null,
          role_title: c.role_title || null,
          remarks: c.remarks || null,
        }));
      if (contactRows.length > 0) {
        await placementDb.insertContacts(contactRows);
      }
    }
    res.status(201).json(data);
  } catch (error) {
    logger.error('Error adding company:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

/**
 * PUT /placement/companies/:id
 * Update a company. Body: company_name, description, company_type, address, website, linkedin, remarks, company_logo_link.
 */
exports.updateCompany = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid company id' });
    const body = req.body || {};

    let remarks = body.remarks;
    if (remarks != null && !Array.isArray(remarks)) {
      remarks = typeof remarks === 'string' ? (remarks ? [remarks] : []) : [String(remarks)];
    }
    const payload = {
      updated_at: new Date().toISOString(),
    };
    if (body.company_name != null) payload.company_name = String(body.company_name).trim();
    if (body.description != null) payload.description = body.description;
    if (body.company_type != null) payload.company_type = body.company_type;
    else if (body.industry != null) payload.company_type = body.industry;
    if (body.address != null) payload.address = body.address;
    if (body.website != null) payload.website = body.website;
    if (body.linkedin != null) payload.linkedin = body.linkedin;
    if (remarks != null) payload.remarks = remarks.length ? remarks : null;
    if (body.company_logo_link != null) payload.company_logo_link = body.company_logo_link;
    if (body.logo != null) payload.company_logo_link = body.logo;

    let data;
    try {
      data = await placementDb.updateCompany(id, payload);
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ message: 'Company with this name already exists' });
      throw error;
    }
    if (!data) return res.status(404).json({ message: 'Company not found' });
    res.json(data);
  } catch (error) {
    logger.error('Error updating company:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

/**
 * DELETE /placement/companies/:id
 * Delete a company and its contacts.
 */
exports.deleteCompany = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid company id' });

    await placementDb.deleteCompany(id);
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting company:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

/**
 * GET /placement/companies/:id/contacts
 * List contacts for a company.
 */
exports.getCompanyContacts = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid company id' });

    const data = await placementDb.getCompanyContacts(id);
    res.json(data);
  } catch (error) {
    logger.error('Error fetching company contacts:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /placement/companies/:id/contacts
 * Add one or more contacts. Body: single object or array of { contact_name, email, phone_number, role_title, remarks }.
 */
exports.addCompanyContacts = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid company id' });

    const body = req.body || {};
    const raw = Array.isArray(body) ? body : (body.contacts ? body.contacts : (body.contact_name || body.email || body.phone_number ? [body] : []));
    const contactRows = raw
      .filter((c) => c && (c.contact_name || c.email || c.phone_number))
      .map((c) => ({
        company_id: id,
        contact_name: c.contact_name || null,
        email: c.email || null,
        phone_number: c.phone_number || null,
        role_title: c.role_title || null,
        remarks: c.remarks || null,
      }));

    if (contactRows.length === 0) {
      return res.status(400).json({ message: 'At least one contact with name, email or phone is required' });
    }

    const data = await placementDb.insertContacts(contactRows);
    res.status(201).json(data);
  } catch (error) {
    logger.error('Error adding company contacts:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

/**
 * PUT /placement/companies/:id/contacts/:contactId
 * Update a contact.
 */
exports.updateCompanyContact = async (req, res) => {
  try {
    const companyId = parseInt(req.params.id, 10);
    const contactId = parseInt(req.params.contactId, 10);
    if (isNaN(companyId) || isNaN(contactId)) return res.status(400).json({ message: 'Invalid id' });

    const body = req.body || {};
    const payload = { updated_at: new Date().toISOString() };
    if (body.contact_name != null) payload.contact_name = body.contact_name;
    if (body.email != null) payload.email = body.email;
    if (body.phone_number != null) payload.phone_number = body.phone_number;
    if (body.role_title != null) payload.role_title = body.role_title;
    if (body.remarks != null) payload.remarks = body.remarks;

    const data = await placementDb.updateContact(contactId, companyId, payload);
    if (!data) return res.status(404).json({ message: 'Contact not found' });
    res.json(data);
  } catch (error) {
    logger.error('Error updating contact:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

/**
 * DELETE /placement/companies/:id/contacts/:contactId
 * Delete a contact.
 */
exports.deleteCompanyContact = async (req, res) => {
  try {
    const companyId = parseInt(req.params.id, 10);
    const contactId = parseInt(req.params.contactId, 10);
    if (isNaN(companyId) || isNaN(contactId)) return res.status(400).json({ message: 'Invalid id' });

    await placementDb.deleteContact(contactId, companyId);
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting contact:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

/**
 * GET /placement/students/overview?academic_year=
 * Returns placement overview rows (by school/program/year) and salary stats for admin Students > Placement Overview tab.
 * Mode is derived from batch_academic_policies: UG by year (1=immersion, 2=internship, 3=capstone&placement, 4=placement), PG any two selected.
 */
exports.getPlacementOverview = async (req, res) => {
  try {
    const academicYear = req.query.academic_year || null;
    const {
      students,
      schools,
      programs,
      policies,
      placementRows,
      placementYears,
    } = await placementDb.getPlacementOverviewData();

    const schoolMap = (schools || []).reduce((acc, s) => { acc[s.id] = s.name; return acc; }, {});
    const programMap = (programs || []).reduce((acc, p) => { acc[p.id] = { name: p.name, graduation_level: p.graduation_level }; return acc; }, {});

    const policyKey = (schoolId, programId, joiningYear) => `${schoolId}-${programId}-${joiningYear || ''}`;
    const policyMap = (policies || []).reduce((acc, p) => {
      acc[policyKey(p.school_id, p.program_id, p.joining_year)] = p;
      return acc;
    }, {});

    const yearLabels = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year', 5: '5th Year', 6: '6th Year' };

    function getMode(graduationLevel, currentYear, joiningYear, schoolId, programId) {
      if (!currentYear) return '-';
      const policy = policyMap[policyKey(schoolId, programId, joiningYear)];
      const level = (graduationLevel || '').toUpperCase();

      if (level === 'PG') {
        const order = [
          { flag: policy?.summer_immersion, label: 'Summer Immersion' },
          { flag: policy?.summer_internship, label: 'Summer Internship' },
          { flag: policy?.capstone, label: 'Capstone & Placement' },
          { flag: policy?.placement, label: 'Placement' }
        ];
        const selected = order.filter((o) => o.flag).map((o) => o.label);
        if (currentYear === 1) return selected[0] || 'Foundation';
        if (currentYear >= 2) return selected[1] || 'Foundation';
        return 'Foundation';
      }

      if (level === 'UG' || !level) {
        if (currentYear === 1) return policy?.summer_immersion ? 'Summer Immersion' : 'Foundation';
        if (currentYear === 2) return policy?.summer_internship ? 'Summer Internship' : 'Foundation';
        if (currentYear === 3) return policy?.capstone ? 'Capstone & Placement' : 'Foundation';
        if (currentYear >= 4) return policy?.placement ? 'Placement' : 'Foundation';
      }

      return 'Foundation';
    }

    // Parse academic year to get start year (e.g. "2023", "2023-24", "2024" -> 2023)
    const parseAcademicYearStart = (ay) => {
      if (!ay) return null;
      const str = String(ay).trim();
      const m = str.match(/^(\d{4})/);
      return m ? parseInt(m[1], 10) : parseInt(str, 10) || null;
    };

    const key = (schoolId, programId, year) => `${schoolId}-${programId}-${year}`;
    const agg = {};
    const academicYearStart = parseAcademicYearStart(academicYear);

    (students || []).forEach((s) => {
      const prog = programMap[s.program_id];
      const isPG = (prog && prog.graduation_level || '').toUpperCase() === 'PG';
      const maxYear = isPG ? 2 : 6; // PG: 2 years (master's); UG: up to 6 years

      // When academic year is selected: compute effective year from year_of_joining
      // year_of_joining = when they joined THIS program (PG students joined PG here, not bachelor's)
      // Formula: effective_year = academicYearStart - year_of_joining + 1
      let yearToUse;
      if (academicYearStart != null && s.year_of_joining != null) {
        const effectiveYear = academicYearStart - Number(s.year_of_joining) + 1;
        if (effectiveYear < 1 || effectiveYear > maxYear) return; // PG: 1-2, UG: 1-6
        yearToUse = effectiveYear;
      } else {
        yearToUse = s.current_year;
        if (!yearToUse) return;
      }

      const k = key(s.school_id, s.program_id, yearToUse);
      if (!agg[k]) {
        const schoolName = schoolMap[s.school_id] || 'Unknown';
        agg[k] = {
          school: schoolName,
          course: prog ? prog.name : 'Unknown',
          currentYear: yearToUse,
          currentYearLabel: yearLabels[yearToUse] || `${yearToUse}`,
          batchStrength: 0,
          mode: getMode(prog && prog.graduation_level, yearToUse, s.year_of_joining, s.school_id, s.program_id),
          studentsTrained: 0,
          optedIn: 0,
          currentPlacement: 0,
          graduationLevel: prog && prog.graduation_level
        };
      }
      agg[k].batchStrength += 1;
    });

    const placementRowsFiltered = academicYear
      ? (placementRows || []).filter((p) => {
          const py = String(p.academic_year || '').trim();
          const ay = String(academicYear).trim();
          if (py === ay) return true;
          const ayStart = parseAcademicYearStart(ay);
          const pyStart = parseAcademicYearStart(py);
          if (ayStart != null && pyStart != null && ayStart === pyStart) return true; // "2023" and "2023-24" match
          return false;
        })
      : (placementRows || []);
    const placementByStudent = placementRowsFiltered.reduce((acc, p) => {
      acc[p.student_id] = (acc[p.student_id] || []).concat(p);
      return acc;
    }, {});

    // Compute schoolOverview from live placement data (by school)
    const schoolOverview = {};
    const studentToSchool = {};
    (students || []).forEach((s) => {
      const schoolName = schoolMap[s.school_id] || 'Unknown';
      studentToSchool[s.usn] = schoolName;
      if (!schoolOverview[schoolName]) schoolOverview[schoolName] = { max: 0, min: 0, avg: 0, median: 0, paidInternships: 0 };
    });
    const ctcBySchool = {};
    (placementRowsFiltered || []).forEach((pl) => {
      const schoolName = studentToSchool[pl.student_id];
      if (!schoolName) return;
      const ctc = pl.ctc_max_lpa != null ? Number(pl.ctc_max_lpa) : pl.ctc_min_lpa != null ? Number(pl.ctc_min_lpa) : null;
      if (ctc != null && !Number.isNaN(ctc)) {
        if (!ctcBySchool[schoolName]) ctcBySchool[schoolName] = [];
        ctcBySchool[schoolName].push(ctc);
      }
    });
    const roundLpa = (n) => Math.round(Number(n) * 100) / 100;
    Object.keys(ctcBySchool).forEach((name) => {
      const vals = ctcBySchool[name].sort((a, b) => a - b);
      if (vals.length > 0) {
        schoolOverview[name] = schoolOverview[name] || { max: 0, min: 0, avg: 0, median: 0, paidInternships: 0 };
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const median = vals.length % 2 === 1
          ? vals[Math.floor(vals.length / 2)]
          : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
        schoolOverview[name].max = roundLpa(Math.max(...vals));
        schoolOverview[name].min = roundLpa(Math.min(...vals));
        schoolOverview[name].avg = roundLpa(avg);
        schoolOverview[name].median = roundLpa(median);
      }
    });

    // Rows always from live aggregation (batch strength recalculated from year_of_joining when academic year selected)
    const rows = Object.values(agg).sort((a, b) => {
      const sc = (a.school || '').localeCompare(b.school || '');
      if (sc !== 0) return sc;
      const cc = (a.course || '').localeCompare(b.course || '');
      if (cc !== 0) return cc;
      return (a.currentYear || 0) - (b.currentYear || 0);
    });

    // Build academic years: from placement academic_year and students' year_of_joining
    const fromPlacement = (placementYears || []).map((r) => parseAcademicYearStart(r.academic_year)).filter(Boolean);
    const fromJoining = [...new Set((students || []).map((s) => s.year_of_joining).filter(Boolean))];
    const allStarts = [...new Set([...fromPlacement, ...fromJoining])].filter((y) => y >= 2000 && y <= 2030);
    const minYear = allStarts.length > 0 ? Math.min(...allStarts) : new Date().getFullYear();
    const maxYear = allStarts.length > 0 ? Math.max(...allStarts) : new Date().getFullYear();
    const academicYears = [];
    for (let y = maxYear; y >= minYear; y--) {
      academicYears.push(`${y}-${String(y + 1).slice(-2)}`);
    }

    res.json({ rows, schoolOverview, academicYears });
  } catch (err) {
    logger.error('getPlacementOverview:', err);
    res.status(500).json({ message: 'Server error fetching placement overview' });
  }
};

/**
 * GET /placement/policies - list batch_academic_policies with school/program names and alumni_conversion_pct
 */
exports.getAllPolicies = async (req, res) => {
  try {
    const policies = await policiesDb.getAllPoliciesWithNames();
    const students = await policiesDb.getStudentsForBatchKeys();
    const batchToUsns = {};
    students.forEach((s) => {
      const key = `${s.school_id}|${s.program_id}|${s.year_of_joining}`;
      if (!batchToUsns[key]) batchToUsns[key] = [];
      batchToUsns[key].push(s.usn);
    });
    const alumniIds = await policiesDb.getAlumniStudentIds();
    const alumniUsnSet = new Set(alumniIds);

    const list = policies.map((p) => {
      const key = `${p.school_id}|${p.program_id}|${p.joining_year}`;
      const batchUsns = batchToUsns[key] || [];
      const studentCount = batchUsns.length;
      const alumniCount = batchUsns.filter((usn) => alumniUsnSet.has(usn)).length;
      const alumni_conversion_pct = studentCount > 0 ? Math.round((alumniCount / studentCount) * 1000) / 10 : 0;
      return {
        ...p,
        school_name: p.school_name || null,
        program_name: p.program_name || null,
        alumni_conversion_pct,
        alumni_count: alumniCount,
        student_count: studentCount,
      };
    });
    res.json(list);
  } catch (err) {
    logger.error('getAllPolicies:', err);
    res.status(500).json({ message: 'Server error fetching policies' });
  }
};

/**
 * POST /placement/policies - upsert one batch_academic_policy
 * Also updates all matching students' eligibility columns in student_basic_details
 */
exports.upsertPolicy = async (req, res) => {
  try {
    const body = req.body;
    const id = body.id ? parseInt(body.id, 10) : null;
    const payload = {
      joining_year: body.joining_year,
      school_id: body.school_id,
      program_id: body.program_id,
      summer_immersion: body.summer_immersion === true,
      summer_internship: body.summer_internship === true,
      capstone: body.capstone === true,
      placement: body.placement === true,
      alumni: body.alumni === true,
      remarks: body.remarks || null
    };

    const policyData = await policiesDb.upsertPolicy(id && !Number.isNaN(id) ? id : null, payload);

    let studentsUpdated = 0;
    try {
      studentsUpdated = await policiesDb.updateStudentEligibilityByBatch(
        payload.school_id,
        payload.program_id,
        payload.joining_year,
        {
          is_summer_immersion_eligible: payload.summer_immersion,
          is_summer_internship_eligible: payload.summer_internship,
          is_capstone_eligible: payload.capstone,
          is_placement_eligible: payload.placement,
        }
      );
      logger.info(`Updated eligibility for ${studentsUpdated} students (school_id=${payload.school_id}, program_id=${payload.program_id}, year=${payload.joining_year})`);
    } catch (studentUpdateError) {
      logger.warn('Failed to update student eligibility columns:', studentUpdateError?.message);
    }

    // Return policy data along with student update count
    res.status(id ? 200 : 201).json({
      ...policyData,
      students_updated: studentsUpdated
    });
  } catch (err) {
    logger.error('upsertPolicy:', err);
    res.status(500).json({ message: err.message || 'Failed to upsert policy' });
  }
};

/**
 * GET /placement/students/eligibility - get students with their eligibility flags
 * Query: school_id, program_id, search, limit
 */
exports.getStudentsEligibility = async (req, res) => {
  try {
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const schoolId = req.query.school_id ? parseInt(req.query.school_id, 10) : null;
    const programId = req.query.program_id ? parseInt(req.query.program_id, 10) : null;

    const { students: rows, total } = await policiesDb.fetchStudentsEligibilityPage({
      limit,
      offset,
      schoolId: schoolId != null && !Number.isNaN(schoolId) ? schoolId : null,
      programId: programId != null && !Number.isNaN(programId) ? programId : null,
      search: search || null,
    });

    const students = rows.map((s) => ({
      usn: s.usn,
      full_name: s.full_name,
      college_email: s.college_email,
      school_id: s.school_id,
      program_id: s.program_id,
      year_of_joining: s.year_of_joining,
      school_name: s.school_name || s.school_abbr || '',
      program_name: s.program_name || '',
      is_summer_immersion_eligible: !!s.is_summer_immersion_eligible,
      is_summer_internship_eligible: !!s.is_summer_internship_eligible,
      is_capstone_eligible: !!s.is_capstone_eligible,
      is_placement_eligible: !!s.is_placement_eligible,
    }));

    res.json({ students, total, page, limit });
  } catch (err) {
    logger.error('getStudentsEligibility:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch students' });
  }
};

/**
 * PUT /placement/students/:usn/eligibility - update individual student eligibility
 */
exports.updateStudentEligibility = async (req, res) => {
  try {
    const { usn } = req.params;
    if (!usn) {
      return res.status(400).json({ message: 'USN is required' });
    }

    const body = req.body;
    const payload = {
      updated_at: new Date().toISOString()
    };

    // Only update fields that are explicitly provided
    if (typeof body.is_summer_immersion_eligible === 'boolean') {
      payload.is_summer_immersion_eligible = body.is_summer_immersion_eligible;
    }
    if (typeof body.is_summer_internship_eligible === 'boolean') {
      payload.is_summer_internship_eligible = body.is_summer_internship_eligible;
    }
    if (typeof body.is_capstone_eligible === 'boolean') {
      payload.is_capstone_eligible = body.is_capstone_eligible;
    }
    if (typeof body.is_placement_eligible === 'boolean') {
      payload.is_placement_eligible = body.is_placement_eligible;
    }

    const data = await policiesDb.updateStudentEligibilityByUsn(usn, payload);
    if (!data) return res.status(404).json({ message: 'Student not found' });

    logger.info(`Updated eligibility for student ${usn}`);
    res.json(data);
  } catch (err) {
    logger.error('updateStudentEligibility:', err);
    res.status(500).json({ message: err.message || 'Failed to update student eligibility' });
  }
};

/**
 * PUT /placement/students/eligibility/bulk - bulk update student eligibility
 */
exports.bulkUpdateStudentEligibility = async (req, res) => {
  try {
    const { usns, eligibility } = req.body;
    
    if (!usns || !Array.isArray(usns) || usns.length === 0) {
      return res.status(400).json({ message: 'USNs array is required' });
    }

    const payload = {
      updated_at: new Date().toISOString()
    };

    if (typeof eligibility.is_summer_immersion_eligible === 'boolean') {
      payload.is_summer_immersion_eligible = eligibility.is_summer_immersion_eligible;
    }
    if (typeof eligibility.is_summer_internship_eligible === 'boolean') {
      payload.is_summer_internship_eligible = eligibility.is_summer_internship_eligible;
    }
    if (typeof eligibility.is_capstone_eligible === 'boolean') {
      payload.is_capstone_eligible = eligibility.is_capstone_eligible;
    }
    if (typeof eligibility.is_placement_eligible === 'boolean') {
      payload.is_placement_eligible = eligibility.is_placement_eligible;
    }

    const count = await policiesDb.bulkUpdateStudentEligibility(usns, payload);

    logger.info(`Bulk updated eligibility for ${count} students`);
    res.json({ success: true, updated: count || usns.length });
  } catch (err) {
    logger.error('bulkUpdateStudentEligibility:', err);
    res.status(500).json({ message: err.message || 'Failed to bulk update student eligibility' });
  }
};

/**
 * GET /placement/policies/me - get batch academic policy for the logged-in student (by usn -> school_id, program_id, year_of_joining)
 * Returns both the batch policy flags and the student's individual eligibility columns
 */
exports.getMyPolicy = async (req, res) => {
  try {
    const usn = req.user?.usn;
    if (!usn) return res.status(403).json({ message: 'Student USN required' });

    const student = await policiesDb.getStudentPolicyContext(usn);

    if (!student?.school_id || !student?.program_id || student?.year_of_joining == null) {
      return res.json({
        school_id: student?.school_id || null,
        program_id: student?.program_id || null,
        joining_year: student?.year_of_joining || null,
        summer_immersion: false,
        summer_internship: false,
        capstone: false,
        placement: false,
        opt_in: !!student?.opt_in,
        // Student's individual eligibility flags
        is_summer_immersion_eligible: !!student?.is_summer_immersion_eligible,
        is_summer_internship_eligible: !!student?.is_summer_internship_eligible,
        is_capstone_eligible: !!student?.is_capstone_eligible,
        is_placement_eligible: !!student?.is_placement_eligible
      });
    }

    const policy = await policiesDb.getBatchPolicy(
      student.school_id,
      student.program_id,
      student.year_of_joining
    );

    if (!policy) {
      return res.json({
        school_id: student.school_id,
        program_id: student.program_id,
        joining_year: student.year_of_joining,
        summer_immersion: false,
        summer_internship: false,
        capstone: false,
        placement: false,
        opt_in: !!student.opt_in,
        // Student's individual eligibility flags
        is_summer_immersion_eligible: !!student.is_summer_immersion_eligible,
        is_summer_internship_eligible: !!student.is_summer_internship_eligible,
        is_capstone_eligible: !!student.is_capstone_eligible,
        is_placement_eligible: !!student.is_placement_eligible
      });
    }

    res.json({
      school_id: student.school_id,
      program_id: student.program_id,
      joining_year: student.year_of_joining,
      summer_immersion: !!policy.summer_immersion,
      summer_internship: !!policy.summer_internship,
      capstone: !!policy.capstone,
      placement: !!policy.placement,
      opt_in: !!student.opt_in,
      // Student's individual eligibility flags (these are set when admin saves policy)
      is_summer_immersion_eligible: !!student.is_summer_immersion_eligible,
      is_summer_internship_eligible: !!student.is_summer_internship_eligible,
      is_capstone_eligible: !!student.is_capstone_eligible,
      is_placement_eligible: !!student.is_placement_eligible
    });
  } catch (err) {
    logger.error('getMyPolicy:', err);
    res.status(500).json({ message: err.message || 'Failed to get policy' });
  }
};

/**
 * POST /placement/policies/sync - create policies for each (school, program, joining_year) from students/schools/programs
 */
exports.syncPolicies = async (req, res) => {
  try {
    const inserted = await policiesDb.syncPoliciesFromCatalog();
    res.json({ message: `Synced; ${inserted} new policies added.` });
  } catch (err) {
    logger.error('syncPolicies:', err);
    res.status(500).json({ message: err.message || 'Sync failed' });
  }
};

/**
 * GET /placement/alumni/conversions
 * Query: school_id, program_id (optional for meta).
 * With both: returns rows of students (usn, name, emails, program, year_of_joining, course_year [min-max], is_placed).
 * Without both: returns schools and programs for dropdowns.
 */
exports.getAlumniConversions = async (req, res) => {
  try {
    const schoolId = req.query.school_id ? parseInt(req.query.school_id, 10) : null;
    const programId = req.query.program_id ? parseInt(req.query.program_id, 10) : null;

    const { schools: schoolsList, programs: programsList } = await alumniDb.getAlumniConversionsMeta();

    if (schoolId == null || programId == null || Number.isNaN(schoolId) || Number.isNaN(programId)) {
      return res.json({
        schools: schoolsList || [],
        programs: (programsList || []).map((p) => ({ id: p.id, name: p.name, school_id: p.school_id })),
        rows: []
      });
    }

    const studentList = await alumniDb.getStudentsBySchoolProgram(schoolId, programId);
    if (studentList.length === 0) {
      return res.json({ schools: schoolsList || [], programs: (programsList || []).map((p) => ({ id: p.id, name: p.name, school_id: p.school_id })), rows: [] });
    }

    const usns = studentList.map((s) => s.usn).filter(Boolean);
    const existingAlumni = await alumniDb.getAlumniByStudentIds(usns);
    const convertedUsns = new Set(existingAlumni.map((a) => a.student_id).filter(Boolean));
    const studentListNotConverted = studentList.filter((s) => !convertedUsns.has(s.usn));

    const program = (programsList || []).find((p) => p.id === programId);
    const minY = program?.min_duration_years ?? 3;
    const maxY = program?.max_duration_years ?? 4;
    const programName = program?.name ?? null;

    const placedIds = await alumniDb.getAcceptedOfferStudentIds(usns);
    const placedUsns = new Set(placedIds.filter(Boolean));

    const rows = studentListNotConverted.map((s) => ({
      usn: s.usn,
      full_name: s.full_name,
      college_email: s.college_email,
      personal_email: s.personal_email,
      program: programName,
      year_of_joining: s.year_of_joining,
      course_year_min: minY,
      course_year_max: maxY,
      is_placed: placedUsns.has(s.usn),
      opt_in: !!s.opt_in
    }));

    res.json({
      schools: schoolsList || [],
      programs: (programsList || []).map((p) => ({ id: p.id, name: p.name, school_id: p.school_id })),
      rows
    });
  } catch (err) {
    logger.error('getAlumniConversions:', err);
    res.status(500).json({ message: err.message || 'Server error fetching alumni conversions' });
  }
};

/**
 * POST /placement/alumni/convert
 * Body: { usns: string[] }. Converts student → alumni: update user_login role (RVU email only, no new login row),
 * insert into alumni table. Logs to alumni_conversion_log and admin_audit_logs. Reverts failed at end.
 */
exports.convertToAlumni = async (req, res) => {
  const usns = Array.isArray(req.body.usns) ? req.body.usns.filter((u) => u != null && String(u).trim()) : [];
  if (usns.length === 0) {
    return res.status(400).json({ message: 'usns array is required and must not be empty' });
  }

  const adminUserId = req.user && req.user.id != null ? req.user.id : null;
  let studentRoleId;
  let alumniRoleId;
  const batchId = require('crypto').randomUUID();
  const results = [];

  try {
    const roleRes = await pool.query("SELECT id, name FROM roles WHERE name IN ('student', 'alumni')");
    const roleMap = {};
    roleRes.rows.forEach((r) => { roleMap[r.name] = r.id; });
    studentRoleId = roleMap.student;
    alumniRoleId = roleMap.alumni;
    if (!studentRoleId || !alumniRoleId) {
      return res.status(500).json({ message: 'Student or alumni role not found in roles table' });
    }

    const studentRes = await pool.query(
      `SELECT s.usn, s.college_email, s.personal_email, s.full_name, s.year_of_joining, s.phone_number, sc.name AS school_name
       FROM student_basic_details s
       LEFT JOIN schools sc ON sc.id = s.school_id
       WHERE s.usn = ANY($1)`,
      [usns]
    );
    const studentMap = new Map();
    studentRes.rows.forEach((r) => {
      const pe = (r.personal_email && String(r.personal_email).trim()) || null;
      const ce = (r.college_email && String(r.college_email).trim()) || null;
      if (ce && pe) {
        studentMap.set(r.usn, {
          college_email: ce.toLowerCase(),
          personal_email: pe.toLowerCase(),
          full_name: (r.full_name && String(r.full_name).trim()) || null,
          graduation_year: r.year_of_joining != null ? parseInt(r.year_of_joining, 10) : null,
          institution_name: (r.school_name && String(r.school_name).trim()) || 'RV University',
          phone_number: (r.phone_number && String(r.phone_number).trim()) || null
        });
      }
    });

    for (const usn of usns) {
      const student = studentMap.get(usn);
      if (!student) {
        results.push({ usn, success: false, error_message: 'Missing or invalid college/personal email' });
        continue;
      }

      const rvuEmail = student.college_email;
      const personalEmail = student.personal_email;
      let logId;

      try {
        const logIns = await pool.query(
          `INSERT INTO alumni_conversion_log (batch_id, usn, rvu_email, personal_email, status)
           VALUES ($1, $2, $3, $4, 'pending')
           RETURNING id`,
          [batchId, usn, rvuEmail, personalEmail]
        );
        logId = logIns.rows[0].id;

        const loginRow = await pool.query(
          'SELECT id FROM user_login WHERE email_id = $1 AND role_id = $2 AND is_active = true',
          [rvuEmail, studentRoleId]
        );
        if (loginRow.rows.length === 0) {
          await pool.query(
            'UPDATE alumni_conversion_log SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
            ['failed', 'No active student login found for this college email', logId]
          );
          results.push({ usn, success: false, error_message: 'No active student login found for college email' });
          continue;
        }

        const collegeLoginId = loginRow.rows[0].id;

        await pool.query(
          'UPDATE user_login SET role_id = $1, updated_at = NOW() WHERE id = $2',
          [alumniRoleId, collegeLoginId]
        );

        const alumniCheck = await pool.query('SELECT id FROM alumni WHERE student_id = $1', [usn]);
        if (alumniCheck.rows.length === 0) {
          await pool.query(
            `INSERT INTO alumni (student_id, full_name, graduation_year, institution_name, personal_email, phone_number, is_verified)
             VALUES ($1, $2, $3, $4, $5, $6, true)`,
            [
              usn,
              student.full_name || usn,
              student.graduation_year,
              student.institution_name,
              personalEmail,
              student.phone_number
            ]
          );
        }

        await pool.query(
          `UPDATE alumni_conversion_log SET role_converted = true, personal_mail_row_created = false, status = 'success', updated_at = NOW() WHERE id = $1`,
          [logId]
        );

        if (adminUserId != null) {
          await pool.query(
            `INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, metadata)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              adminUserId,
              'alumni_conversion',
              'alumni',
              usn,
              JSON.stringify({ batch_id: batchId, rvu_email: rvuEmail, personal_email: personalEmail, role_converted: true })
            ]
          );
        }

        results.push({ usn, success: true });
      } catch (err) {
        logger.error('convertToAlumni single:', usn, err);
        const errMsg = err.message || 'Conversion failed';
        if (logId) {
          await pool.query(
            'UPDATE alumni_conversion_log SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
            ['failed', errMsg.substring(0, 500), logId]
          );
        }
        results.push({ usn, success: false, error_message: errMsg });
      }
    }

    const failed = results.filter((r) => !r.success);
    for (const f of failed) {
      const student = studentMap.get(f.usn);
      if (!student) continue;
      const rvuEmail = student.college_email;
      try {
        await pool.query(
          'UPDATE user_login SET role_id = $1, updated_at = NOW() WHERE email_id = $2 AND role_id = $3',
          [studentRoleId, rvuEmail, alumniRoleId]
        );
      } catch (_) { /* ignore */ }
      try {
        await pool.query('DELETE FROM alumni WHERE student_id = $1', [f.usn]);
      } catch (_) { /* ignore */ }
      await pool.query(
        "UPDATE alumni_conversion_log SET status = 'reverted', updated_at = NOW() WHERE usn = $1 AND batch_id = $2 AND status = 'failed'",
        [f.usn, batchId]
      );
    }

    const converted = results.filter((r) => r.success).length;
    const total = results.length;
    res.json({
      total,
      converted,
      failed: failed.length,
      success_rate_pct: total ? Math.round((converted / total) * 1000) / 10 : 0,
      results,
      failed_list: failed.map((r) => ({ usn: r.usn, error_message: r.error_message })),
    });
  } catch (err) {
    logger.error('convertToAlumni:', err);
    res.status(500).json({ message: err.message || 'Server error during conversion' });
  }
};

/**
 * GET /placement/alumni/conversion-logs
 * Returns alumni_conversion_log rows for the Conversion logs tab.
 */
exports.getAlumniConversionLogs = async (req, res) => {
  try {
    const { batch_id, status, limit = 200 } = req.query;
    let query = 'SELECT id, batch_id, usn, rvu_email, personal_email, role_converted, personal_mail_row_created, status, error_message, created_at, updated_at FROM alumni_conversion_log';
    const params = [];
    const conditions = [];
    let idx = 1;
    if (batch_id) {
      conditions.push(`batch_id = $${idx}`);
      params.push(batch_id);
      idx++;
    }
    if (status) {
      conditions.push(`status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY created_at DESC';
    const limitVal = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));
    query += ` LIMIT ${limitVal}`;

    const result = await pool.query(query, params);
    res.json({ logs: result.rows || [] });
  } catch (err) {
    logger.error('getAlumniConversionLogs:', err);
    res.status(500).json({ message: err.message || 'Server error fetching conversion logs' });
  }
};

// --- Alumni ---

/**
 * GET /placement/alumni - list all alumni
 */
exports.getAllAlumni = async (req, res) => {
  try {
    const data = await alumniDb.getAllAlumniOrdered();
    const hasProfileData = (a) => {
      const hasEmail = !!(a.personal_email && String(a.personal_email).trim());
      const hasCareer = !!(a.current_company && String(a.current_company).trim()) || !!(a.current_designation && String(a.current_designation).trim());
      const hasPhone = !!(a.phone_number && String(a.phone_number).trim());
      return hasEmail && (hasCareer || hasPhone);
    };
    const list = (data || []).map((a) => ({
      ...a,
      usn: a.student_id,
      profile_data_added: hasProfileData(a)
    }));
    res.json(list);
  } catch (err) {
    logger.error('getAllAlumni:', err);
    res.status(500).json({ message: err.message || 'Server error fetching alumni' });
  }
};

/**
 * POST /placement/alumni - add alumni (manual)
 * Body: usn (-> student_id), full_name, graduation_year, institution_name, current_company,
 *       current_designation, current_work_location, personal_email, phone_number, linkedin, other_links
 */
exports.addAlumni = async (req, res) => {
  try {
    const b = req.body;
    if (!b.full_name) return res.status(400).json({ message: 'full_name is required' });

    const payload = {
      student_id: b.usn || b.student_id || null,
      full_name: b.full_name,
      graduation_year: b.graduation_year ? parseInt(b.graduation_year, 10) : null,
      institution_name: b.institution_name || null,
      current_company: b.current_company || null,
      current_designation: b.current_designation || null,
      current_work_location: b.current_work_location || null,
      personal_email: b.personal_email || null,
      phone_number: b.phone_number || null,
      linkedin: b.linkedin || null,
      other_links: typeof b.other_links === 'string' ? b.other_links || null : (b.other_links || null),
      is_verified: true
    };

    const data = await alumniDb.insertAlumni(payload);
    res.status(201).json({ ...data, usn: data.student_id });
  } catch (err) {
    logger.error('addAlumni:', err);
    res.status(500).json({ message: err.message || 'Failed to add alumni' });
  }
};

/**
 * GET /placement/alumni/:identifier - get one alumni by student_id (usn) or numeric id
 */
exports.getAlumniByIdOrUsn = async (req, res) => {
  try {
    const { identifier } = req.params;
    const idNum = parseInt(identifier, 10);
    const byId = !Number.isNaN(idNum);

    const data = await alumniDb.getAlumniByIdentifier(byId ? idNum : identifier, byId);
    if (!data) return res.status(404).json({ message: 'Alumni not found' });
    res.json({ ...data, usn: data.student_id });
  } catch (err) {
    logger.error('getAlumniByIdOrUsn:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
};

/**
 * PUT /placement/alumni/:identifier - update alumni (by id or student_id)
 */
exports.updateAlumni = async (req, res) => {
  try {
    const { identifier } = req.params;
    const b = req.body;
    const idNum = parseInt(identifier, 10);
    const byId = !Number.isNaN(idNum);

    const existing = await alumniDb.getAlumniIdByIdentifier(byId ? idNum : identifier, byId);
    if (!existing) return res.status(404).json({ message: 'Alumni not found' });

    const payload = {
      full_name: b.full_name,
      graduation_year: b.graduation_year != null ? parseInt(b.graduation_year, 10) : undefined,
      institution_name: b.institution_name ?? undefined,
      alumni_remark: b.alumni_remark ?? undefined,
      current_company: b.current_company,
      current_designation: b.current_designation,
      current_work_location: b.current_work_location,
      personal_email: b.personal_email,
      phone_number: b.phone_number,
      linkedin: b.linkedin,
      other_links: b.other_links,
      updated_at: new Date().toISOString()
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const updated = await alumniDb.updateAlumni(existing.id, payload);
    res.json({ ...updated, usn: updated.student_id });
  } catch (err) {
    logger.error('updateAlumni:', err);
    res.status(500).json({ message: err.message || 'Update failed' });
  }
};

/**
 * GET /placement/alumni/me - get current alumni profile (by logged-in user email)
 */
exports.getAlumniMe = async (req, res) => {
  try {
    const email = (req.user && req.user.email) ? String(req.user.email).trim().toLowerCase() : null;
    if (!email) {
      return res.status(403).json({ message: 'Alumni profile not found for this account.' });
    }
    const data = await alumniDb.getAlumniByEmail(email);
    if (!data) return res.status(404).json({ message: 'Alumni profile not found.' });
    res.json({ ...data, usn: data.student_id });
  } catch (err) {
    logger.error('getAlumniMe:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
};

/**
 * PUT /placement/alumni/me - update current alumni profile
 */
exports.updateAlumniMe = async (req, res) => {
  try {
    const email = (req.user && req.user.email) ? String(req.user.email).trim().toLowerCase() : null;
    if (!email) {
      return res.status(403).json({ message: 'Alumni profile not found for this account.' });
    }
    const existing = await alumniDb.getAlumniIdByEmail(email);
    if (!existing) return res.status(404).json({ message: 'Alumni profile not found.' });

    const b = req.body;
    const payload = {
      full_name: b.full_name,
      graduation_year: b.graduation_year != null ? parseInt(b.graduation_year, 10) : undefined,
      institution_name: b.institution_name ?? undefined,
      current_company: b.current_company ?? undefined,
      current_designation: b.current_designation ?? undefined,
      current_work_location: b.current_work_location ?? undefined,
      personal_email: b.personal_email ?? undefined,
      phone_number: b.phone_number ?? undefined,
      linkedin: b.linkedin ?? undefined,
      other_links: b.other_links ?? undefined,
      alumni_remark: b.alumni_remark ?? undefined,
      profile_image: b.profile_image ?? undefined,
      updated_at: new Date().toISOString()
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const updated = await alumniDb.updateAlumni(existing.id, payload);
    res.json({ ...updated, usn: updated.student_id });
  } catch (err) {
    logger.error('updateAlumniMe:', err);
    res.status(500).json({ message: err.message || 'Update failed' });
  }
};

/**
 * GET /placement/alumni/codes - list registration codes
 */
exports.getRegistrationCodes = async (req, res) => {
  try {
    const data = await alumniDb.getRegistrationCodes();
    res.json(data);
  } catch (err) {
    logger.error('getRegistrationCodes:', err);
    res.status(500).json({ message: err.message || 'Server error fetching codes' });
  }
};

/**
 * POST /placement/alumni/codes - create registration code
 * Body: batch_year, institution_name, remarks, max_uses (0 = unlimited)
 */
exports.createRegistrationCode = async (req, res) => {
  try {
    const b = req.body;
    if (!b.batch_year || !b.institution_name) {
      return res.status(400).json({ message: 'batch_year and institution_name are required' });
    }
    const code = `ALUM-${b.batch_year}-${require('crypto').randomBytes(4).toString('hex').toUpperCase()}`;
    const payload = {
      code,
      batch_year: parseInt(b.batch_year, 10),
      institution_name: String(b.institution_name).trim(),
      remarks: b.remarks || '',
      max_uses: Math.max(0, parseInt(b.max_uses, 10) || 0),
      used_count: 0,
      is_active: true,
      created_by: req.user?.id || null
    };

    const data = await alumniDb.insertRegistrationCode(payload);
    res.status(201).json(data);
  } catch (err) {
    logger.error('createRegistrationCode:', err);
    res.status(500).json({ message: err.message || 'Failed to create code' });
  }
};

/**
 * DELETE /placement/alumni/codes/:id - deactivate registration code (set is_active false)
 */
exports.deleteRegistrationCode = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'Invalid code id' });

    const data = await alumniDb.deactivateRegistrationCode(id);
    if (!data) return res.status(404).json({ message: 'Code not found' });
    res.json(data);
  } catch (err) {
    logger.error('deleteRegistrationCode:', err);
    res.status(500).json({ message: err.message || 'Failed to deactivate code' });
  }
};

/**
 * GET /placement/job-offers - get all job offers from offers, placement, and capstone tables (admin)
 */
exports.getAllJobOffers = async (req, res) => {
  try {
    const rows = await placementDb.getAllJobOffersRows();
    const results = rows.map((r) => ({
      id: r.id,
      offer_id: r.id,
      student_id: r.student_id,
      placement_id: r.placement_id,
      capstone_id: r.capstone_id,
      offer_job_type: r.offer_job_type,
      offer_academic_year: r.offer_academic_year,
      offer_remarks: r.offer_remarks,
      offer_created_at: r.offer_created_at,
      offer_updated_at: r.offer_updated_at,
      usn: r.usn || r.student_id,
      student_name: r.student_name || '',
      batch: r.batch,
      school: r.school || r.school_abbr || '',
      program: r.program || '',
      company_id: r.company_id,
      company_name: r.company_name || '',
      placement_designation: r.placement_designation,
      placement_offer_letter_status: r.placement_offer_letter_status,
      placement_job_description: r.placement_job_description,
      placement_ctc_min_lpa: r.placement_ctc_min_lpa,
      placement_ctc_max_lpa: r.placement_ctc_max_lpa,
      placement_ctc_variable_pay: r.placement_ctc_variable_pay,
      placement_ctc_stock_in_lpa: r.placement_ctc_stock_in_lpa,
      placement_type_of_hiring: r.placement_type_of_hiring,
      placement_academic_year: r.placement_academic_year,
      placement_remarks: r.placement_remarks,
      capstone_company_name: r.capstone_company_name,
      capstone_internship_duration_months: r.capstone_internship_duration_months,
      capstone_designation: r.capstone_designation,
      capstone_offer_letter_status: r.capstone_offer_letter_status,
      capstone_internship_stipend_min: r.capstone_internship_stipend_min,
      capstone_internship_stipend_max: r.capstone_internship_stipend_max,
      capstone_description: r.capstone_description,
      capstone_academic_year: r.capstone_academic_year,
      capstone_remarks: r.capstone_remarks,
      designation: r.placement_designation || r.capstone_designation || null,
      job_type: r.offer_job_type || r.placement_type_of_hiring || (r.capstone_id ? 'capstone' : 'full time'),
      ctc_min_lpa: r.placement_ctc_min_lpa,
      ctc_max_lpa: r.placement_ctc_max_lpa,
      ctc: r.placement_ctc_max_lpa || r.placement_ctc_min_lpa || null,
      ctc_variable_pay: r.placement_ctc_variable_pay,
      offer_letter_status: r.placement_offer_letter_status || r.capstone_offer_letter_status || 'Pending',
      academic_year: r.offer_academic_year || r.placement_academic_year || r.capstone_academic_year || null,
      remarks: r.offer_remarks || r.placement_remarks || r.capstone_remarks || null,
      internship_duration: r.capstone_internship_duration_months,
      internship_stipend_min: r.capstone_internship_stipend_min,
      internship_stipend_max: r.capstone_internship_stipend_max,
      created_at: r.offer_created_at,
      updated_at: r.offer_updated_at,
      source: r.capstone_id ? 'capstone' : (r.placement_id ? 'placement' : 'offer'),
    }));
    res.json(results);
  } catch (err) {
    logger.error('[placement] getAllJobOffers:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to fetch job offers') });
  }
};

/**
 * POST /placement/job-offers - add a new job offer
 * Body: usn, company_id, company_name, designation, job_type, ctc_min_lpa, ctc_max_lpa, ctc_variable_pay, offer_letter_status, remarks, process_id
 */
exports.addJobOffer = async (req, res) => {
  try {
    const b = req.body;

    if (!b.usn) {
      return res.status(400).json({ message: 'usn is required' });
    }

    // Validate student exists
    const student = await placementDb.getStudentBasicByUsn(b.usn);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Build placement record
    const placement = {
      student_id: b.usn,
      company_id: b.company_id || null,
      designation: b.designation || null,
      offer_letter_status: b.offer_letter_status || 'Pending',
      ctc_min_lpa: b.ctc_min_lpa || b.ctc_min || null,
      ctc_max_lpa: b.ctc_max_lpa || b.ctc_max || null,
      ctc_variable_pay: b.ctc_variable_pay || b.variable_pay || null,
      ctc_stock_in_lpa: b.ctc_stock_in_lpa || null,
      type_of_hiring: b.job_type || b.type_of_hiring || 'full time',
      academic_year: b.academic_year || new Date().getFullYear().toString(),
      remarks: b.remarks || null,
    };

    // Insert into placement table
    const placementData = await placementDb.insertPlacement(placement);

    // Also insert into offers table (linking table)
    const offer = {
      student_id: b.usn,
      company_id: b.company_id || null,
      placement_id: placementData.id,
      job_type: b.job_type || 'full time',
      academic_year: b.academic_year || new Date().getFullYear().toString(),
      remarks: b.remarks || null,
    };

    let offerData = null;
    try {
      offerData = await placementDb.insertOffer(offer);
    } catch (offerError) {
      logger.warn('addJobOffer offers table insert warning:', offerError?.message);
    }

    res.status(201).json({
      message: 'Job offer added successfully',
      placement: placementData,
      offer: offerData
    });
  } catch (err) {
    logger.error('addJobOffer:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to add job offer') });
  }
};

/**
 * PUT /placement/job-offers/:id - update an existing job offer
 * Body: company_id, designation, job_type, ctc_min_lpa, ctc_max_lpa, ctc_variable_pay, ctc_stock_in_lpa, 
 *       offer_letter_status, academic_year, remarks, type_of_hiring, job_description,
 *       internship_duration_months, internship_stipend_min, internship_stipend_max
 */
exports.updateJobOffer = async (req, res) => {
  try {
    const offerId = parseInt(req.params.id, 10);
    if (Number.isNaN(offerId)) {
      return res.status(400).json({ message: 'Invalid offer id' });
    }

    const b = req.body;

    // First, get the existing offer to find linked placement/capstone
    const existingOffer = await placementDb.getOfferById(offerId);
    if (!existingOffer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    // Update the offers table
    const offerUpdate = {};
    if (b.company_id !== undefined) offerUpdate.company_id = b.company_id;
    if (b.job_type !== undefined) offerUpdate.job_type = b.job_type;
    if (b.academic_year !== undefined) offerUpdate.academic_year = b.academic_year;
    if (b.remarks !== undefined) offerUpdate.remarks = b.remarks;

    if (Object.keys(offerUpdate).length > 0) {
      try {
        await placementDb.updateOffer(offerId, offerUpdate);
      } catch (offerUpdateError) {
        logger.error('updateJobOffer offers update error:', offerUpdateError);
      }
    }

    // Update linked placement record if exists
    if (existingOffer.placement_id) {
      const placementUpdate = {};
      if (b.company_id !== undefined) placementUpdate.company_id = b.company_id;
      if (b.designation !== undefined) placementUpdate.designation = b.designation;
      if (b.offer_letter_status !== undefined) placementUpdate.offer_letter_status = b.offer_letter_status;
      if (b.job_description !== undefined) placementUpdate.job_description = b.job_description;
      if (b.ctc_min_lpa !== undefined) placementUpdate.ctc_min_lpa = b.ctc_min_lpa;
      if (b.ctc_max_lpa !== undefined) placementUpdate.ctc_max_lpa = b.ctc_max_lpa;
      if (b.ctc_variable_pay !== undefined) placementUpdate.ctc_variable_pay = b.ctc_variable_pay;
      if (b.ctc_stock_in_lpa !== undefined) placementUpdate.ctc_stock_in_lpa = b.ctc_stock_in_lpa;
      if (b.type_of_hiring !== undefined) placementUpdate.type_of_hiring = b.type_of_hiring;
      if (b.academic_year !== undefined) placementUpdate.academic_year = b.academic_year;
      if (b.remarks !== undefined) placementUpdate.remarks = b.remarks;

      if (Object.keys(placementUpdate).length > 0) {
        try {
          await placementDb.updatePlacement(existingOffer.placement_id, placementUpdate);
        } catch (placementUpdateError) {
          logger.error('updateJobOffer placement update error:', placementUpdateError);
        }
      }
    }

    // Update linked capstone record if exists
    if (existingOffer.capstone_id) {
      const capstoneUpdate = {};
      if (b.company_name !== undefined) capstoneUpdate.company_name = b.company_name;
      if (b.designation !== undefined) capstoneUpdate.designation = b.designation;
      if (b.offer_letter_status !== undefined) capstoneUpdate.offer_letter_status = b.offer_letter_status;
      if (b.internship_duration_months !== undefined) capstoneUpdate.internship_duration_months = b.internship_duration_months;
      if (b.internship_stipend_min !== undefined) capstoneUpdate.internship_stipend_min = b.internship_stipend_min;
      if (b.internship_stipend_max !== undefined) capstoneUpdate.internship_stipend_max = b.internship_stipend_max;
      if (b.description !== undefined) capstoneUpdate.description = b.description;
      if (b.academic_year !== undefined) capstoneUpdate.academic_year = b.academic_year;
      if (b.remarks !== undefined) capstoneUpdate.remarks = b.remarks;

      if (Object.keys(capstoneUpdate).length > 0) {
        try {
          await placementDb.updateCapstone(existingOffer.capstone_id, capstoneUpdate);
        } catch (capstoneUpdateError) {
          logger.error('updateJobOffer capstone update error:', capstoneUpdateError);
        }
      }
    }

    res.json({ message: 'Job offer updated successfully' });
  } catch (err) {
    logger.error('updateJobOffer:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to update job offer') });
  }
};

/**
 * GET /placement/dashboard/stats
 * Returns dashboard metrics: placementSeeking, totalOffers, totalPlaced, totalInternship, totalInternshipCumFullTime
 */
exports.getDashboardOfferStats = async (req, res) => {
  try {
    const placementSeekingCount = await placementDb.countOptedInStudents();
    const offers = await placementDb.getOffersForDashboard();
    const totalOffers = offers.length;
    
    // Total Placed: Unique students with at least one offer
    const uniquePlacedStudents = new Set(offers.map(o => o.student_id)).size;

    // Internship: saved in capstone table (capstone_id not null)
    // Internship + Full Time: saved in both
    let internshipCount = 0;
    let internshipCumFullTimeCount = 0;
    
    offers.forEach(o => {
      const hasCapstone = !!o.capstone_id;
      const hasPlacement = !!o.placement_id;
      
      if (hasCapstone && hasPlacement) {
        internshipCumFullTimeCount++;
      } else if (hasCapstone) {
        internshipCount++;
      }
    });

    res.json({
      placementSeeking: placementSeekingCount,
      totalOffers: totalOffers,
      totalPlaced: uniquePlacedStudents,
      totalInternship: internshipCount,
      totalInternshipCumFullTime: internshipCumFullTimeCount
    });

  } catch (error) {
    logger.error('getDashboardStats:', error);
    res.status(500).json({ message: apiMessage(error, 'Failed to fetch dashboard stats') });
  }
};

/**
 * Helper: Resolve alumni ID from request user email
 */
async function resolveAlumniId(req) {
  const email = (req.user && req.user.email) ? String(req.user.email).trim().toLowerCase() : null;
  if (!email) return null;
  return alumniDb.resolveAlumniIdByEmail(email);
}

/**
 * POST /placement/alumni/hr-recommendations
 * Submit HR recommendation from alumni
 */
exports.submitHrRecommendation = async (req, res) => {
  try {
    const alumniId = await resolveAlumniId(req);
    if (!alumniId) {
      return res.status(403).json({ message: 'Alumni profile not found for this account' });
    }

    const b = req.body || {};
    
    if (!b.company_name || !b.hr_name) {
      return res.status(400).json({ message: 'Company name and HR name are required' });
    }

    const data = await alumniDb.insertHrRecommendation({
      alumni_id: alumniId,
      company_name: b.company_name,
      hr_name: b.hr_name,
      hr_email: b.hr_email || null,
      hr_phone: b.hr_phone || null,
      hiring_role: b.hiring_role || null,
      opportunity_type: b.opportunity_type || null,
      recommendation_note: b.recommendation_note || null,
      consent_given: b.consent_given === true,
    });

    res.status(201).json({ message: 'HR recommendation submitted successfully', data });
  } catch (err) {
    logger.error('submitHrRecommendation:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to submit recommendation') });
  }
};

/**
 * GET /placement/alumni/hr-recommendations
 * Get all HR recommendations for the logged-in alumni
 */
exports.getMyHrRecommendations = async (req, res) => {
  try {
    const alumniId = await resolveAlumniId(req);
    if (!alumniId) {
      return res.status(403).json({ message: 'Alumni profile not found for this account' });
    }

    const data = await alumniDb.getHrRecommendationsByAlumniId(alumniId);
    res.json(data);
  } catch (err) {
    logger.error('getMyHrRecommendations:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to fetch recommendations') });
  }
};

/**
 * GET /placement/alumni/events
 * Returns events that were sent to alumni (any notification targeting alumni role or ALL with an event link).
 * All alumni see the same set of "alumni events".
 */
exports.getAlumniEvents = async (req, res) => {
  try {
    const userId = req.user?.id ?? req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const notifRes = await pool.query(
      `SELECT n.link FROM notifications n
       WHERE n.is_active = true AND n.link IS NOT NULL AND TRIM(n.link) != ''
         AND ( (n.target_type = 'ROLE' AND (n.target_role ILIKE '%alumni%' OR LOWER(TRIM(n.target_role)) = 'alumni'))
               OR n.target_type = 'ALL' )`
    );
    const eventIds = new Set();
    for (const row of notifRes.rows || []) {
      const link = row.link || '';
      const m = link.match(/event[s]?[\/\-](\d+)/i) || link.match(/[?&]event[=_ ]?(\d+)/i);
      if (m) eventIds.add(parseInt(m[1], 10));
    }
    const ids = [...eventIds];
    if (ids.length === 0) {
      return res.json([]);
    }

    const events = await placementDb.getEventsByIds(ids);
    const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const withImageUrls = events.map((ev) => ({
      ...ev,
      image_url: baseUrl && ev.id
        ? `${baseUrl}/storage/v1/object/public/system-assets/events/${ev.id}.jpg`
        : null,
    }));
    res.json(withImageUrls);
  } catch (err) {
    logger.error('getAlumniEvents:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch events' });
  }
};

/**
 * GET /placement/vc/events
 * VC: all events from events table (all that are going to happen + past), ordered by event_datetime.
 */
exports.getVcEvents = async (req, res) => {
  try {
    const events = await placementDb.getAllEventsOrdered();
    const baseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const withImageUrls = events.map((ev) => ({
      ...ev,
      image_url: baseUrl && ev.id
        ? `${baseUrl}/storage/v1/object/public/system-assets/events/${ev.id}.jpg`
        : null,
    }));
    res.json(withImageUrls);
  } catch (err) {
    logger.error('getVcEvents:', err);
    res.status(500).json({ message: err.message || 'Failed to fetch events' });
  }
};

/**
 * GET /placement/hr-recommendations (admin)
 * Get all HR recommendations for admin review
 */
exports.getAllHrRecommendations = async (req, res) => {
  try {
    const rows = await alumniDb.getHrRecommendations();
    const data = rows.map((r) => ({
      ...r,
      alumni: r.alumni_ref_id
        ? {
            id: r.alumni_ref_id,
            full_name: r.alumni_full_name,
            current_company: r.alumni_current_company,
            personal_email: r.alumni_personal_email,
          }
        : null,
    }));
    res.json(data);
  } catch (err) {
    logger.error('getAllHrRecommendations:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to fetch recommendations') });
  }
};

/**
 * GET /placement/alumni/student/:usn
 * Returns student profile for alumni viewing (limited data, excludes sensitive info)
 */
exports.getStudentProfileForAlumni = async (req, res) => {
  try {
    const { usn } = req.params;
    if (!usn) {
      return res.status(400).json({ message: 'USN is required' });
    }

    const student = await studentDb.getBasicByUsn(usn, `
        usn, full_name, college_email, personal_email,
        phone_country_code, phone_number,
        school_id, program_id, major_id, minor_id, specialization_id,
        year_of_joining, current_year, current_semester,
        social_links, profile_image`);

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const { schoolMap, programMap, majorMap } = await catalogDb.getNameMaps({
      schoolIds: student.school_id ? [student.school_id] : [],
      programIds: student.program_id ? [student.program_id] : [],
      majorIds: student.major_id ? [student.major_id] : [],
    });

    const profileDetails = await studentDb.selectOneByUsn('student_profile_details', usn);

    // Get all approved projects for this student (use student.usn for exact match; status case-insensitive)
    const ownerUsn = student.usn || usn;
    const projRes = await pool.query(
      `SELECT p.id, p.owner_usn, p.title, p.short_description, p.description, p.category,
        p.hosted_url, p.github_url, p.mentor_name, p.tech_stack, p.priority
       FROM projects p
       WHERE p.owner_usn = $1 AND LOWER(TRIM(p.project_status::text)) = 'approved'
       ORDER BY p.priority ASC NULLS LAST, p.id ASC`,
      [ownerUsn]
    );
    const projectRows = projRes.rows || [];
    const projectIds = projectRows.map((r) => r.id);

    let assetsByProj = {};
    let metricsByProj = {};
    let likedSet = new Set();
    let favoritedSet = new Set();
    const userId = req.user ? (req.user.id || req.user.user_id) : null;

    if (projectIds.length > 0) {
      const [assetRes, metricRes, likeRes, favRes] = await Promise.all([
        pool.query(
          `SELECT project_id, original_url, position
           FROM project_assets
           WHERE project_id = ANY($1::bigint[]) AND asset_role IN ('COVER','GALLERY')
           ORDER BY project_id, position`,
          [projectIds]
        ),
        pool.query(
          'SELECT project_id, views, likes, favorites FROM project_metrics WHERE project_id = ANY($1::bigint[])',
          [projectIds]
        ),
        userId ? pool.query(
          'SELECT project_id FROM project_likes WHERE project_id = ANY($1::bigint[]) AND user_id = $2',
          [projectIds, userId]
        ) : { rows: [] },
        userId ? pool.query(
          'SELECT project_id FROM project_favorites WHERE project_id = ANY($1::bigint[]) AND user_id = $2',
          [projectIds, userId]
        ) : { rows: [] },
      ]);
      (assetRes.rows || []).forEach((a) => {
        if (!assetsByProj[a.project_id]) assetsByProj[a.project_id] = [];
        assetsByProj[a.project_id].push(a.original_url);
      });
      (metricRes.rows || []).forEach((m) => { metricsByProj[m.project_id] = m; });
      (likeRes.rows || []).forEach((r) => likedSet.add(r.project_id));
      (favRes.rows || []).forEach((r) => favoritedSet.add(r.project_id));
    }

    const projects = projectRows.map((p) => {
      const m = metricsByProj[p.id] || {};
      return {
        id: p.id,
        owner_usn: p.owner_usn,
        usn: p.owner_usn,
        title: p.title,
        short_description: p.short_description,
        one_line_description: p.short_description,
        description: p.description,
        full_description: p.description,
        category: p.category,
        genre: p.category,
        hosted_url: p.hosted_url,
        hosted_link: p.hosted_url,
        github_url: p.github_url,
        github_repo: p.github_url,
        mentor_name: p.mentor_name,
        tech_stack: Array.isArray(p.tech_stack) ? p.tech_stack : [],
        technologies: Array.isArray(p.tech_stack) ? p.tech_stack : [],
        project_snaps: assetsByProj[p.id] || [],
        views_count: m.views ?? 0,
        likes_count: m.likes ?? 0,
        favorites_count: m.favorites ?? 0,
        is_liked: likedSet.has(p.id),
        is_favorited: favoritedSet.has(p.id),
      };
    });

    const [
      { data: education },
      { data: internships },
      { data: trainings },
      { data: certifications },
      { data: publications },
      { data: extraCurricular },
      { data: otherExperiences },
    ] = await Promise.all([
      studentDb.selectByUsn('student_education_history', usn, { orderBy: 'end_year' }),
      studentDb.selectByUsn('student_internships', usn, { orderBy: 'start_date' }),
      studentDb.selectByUsn('student_trainings', usn, { orderBy: 'start_date' }),
      studentDb.selectByUsn('student_certifications', usn, { orderBy: 'issue_date' }),
      studentDb.selectByUsn('student_publications', usn, { orderBy: 'publication_date' }),
      studentDb.selectByUsn('student_extra_curricular_activities', usn, { orderBy: 'start_date' }),
      studentDb.selectByUsn('student_other_experiences', usn, { orderBy: 'start_date' }),
    ]);

    res.json({
      usn: student.usn,
      personal: {
        ...student,
        schoolName: student.school_id ? schoolMap.get(student.school_id) || null : null,
        programName: student.program_id ? programMap.get(student.program_id)?.name || programMap.get(student.program_id) : null,
        majorName: student.major_id ? majorMap.get(student.major_id) || null : null,
      },
      career: profileDetails || {},
      resume_file: profileDetails?.resume_file || null,
      projects: projects || [],
      education: education || [],
      internships: internships || [],
      trainings: trainings || [],
      certifications: certifications || [],
      publications: publications || [],
      extraCurricular: extraCurricular || [],
      otherExperiences: otherExperiences || [],
    });
  } catch (error) {
    logger.error('getStudentProfileForAlumni:', error);
    res.status(500).json({ message: apiMessage(error, 'Failed to fetch student profile') });
  }
};

/**
 * POST /placement/alumni/connect
 * Create a connection request from alumni to student.
 */
exports.createAlumniConnectionRequest = async (req, res) => {
  try {
    const email = (req.user && req.user.email) ? String(req.user.email).trim().toLowerCase() : null;
    if (!email) {
      return res.status(403).json({ message: 'User context missing.' });
    }

    // Get Alumni ID
    const alumniId = await alumniDb.resolveAlumniIdByEmail(email);
    if (!alumniId) {
      return res.status(404).json({ message: 'Alumni profile not found.' });
    }

    const {
      student_usn,
      connection_purpose,
      message_to_po,
      preferred_contact_date,
      preferred_time_slot,
      contact_mode
    } = req.body;

    if (!student_usn || !connection_purpose || !message_to_po) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    const payload = {
      alumni_id: alumniId,
      student_usn,
      connection_purpose,
      message_to_po,
      preferred_contact_date: preferred_contact_date || null,
      preferred_time_slot: preferred_time_slot || null,
      contact_mode: contact_mode || null,
      status: 'PENDING'
    };

    const data = await alumniDb.insertConnectionRequest(payload);
    res.status(201).json(data);
  } catch (err) {
    logger.error('createAlumniConnectionRequest:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to create connection request') });
  }
};

/**
 * GET /placement/alumni/connection-requests
 * Admin: get all alumni connection requests with alumni and student info.
 */
exports.getAlumniConnectionRequests = async (req, res) => {
  try {
    const statusFilter = (req.query.status || '').trim().toUpperCase();
    const filterVal =
      statusFilter && ['PENDING', 'APPROVED', 'REJECTED', 'CONTACTED'].includes(statusFilter)
        ? statusFilter
        : null;
    const rows = await alumniDb.getConnectionRequests(filterVal);
    const alumniIds = [...new Set(rows.map((r) => r.alumni_id).filter(Boolean))];
    const studentUsns = [...new Set(rows.map((r) => r.student_usn).filter(Boolean))];

    const alumniMap = {};
    const studentMap = {};

    if (alumniIds.length > 0) {
      const alumniRows = await alumniDb.getAlumniByIds(alumniIds);
      alumniRows.forEach((a) => {
        alumniMap[a.id] = a;
      });
    }

    if (studentUsns.length > 0) {
      const studentRows = await alumniDb.getStudentsBriefByUsns(studentUsns);
      studentRows.forEach((s) => {
        studentMap[s.usn] = s;
      });
    }

    const enriched = rows.map((r) => {
      const alum = alumniMap[r.alumni_id];
      const stud = studentMap[r.student_usn];
      return {
        ...r,
        alumni_name: alum?.full_name || '—',
        alumni_email: alum?.personal_email || '—',
        alumni_company: alum?.current_company || '—',
        alumni_designation: alum?.current_designation || '—',
        student_name: stud?.full_name || '—',
        student_email: stud?.college_email || '—',
      };
    });

    res.json({ rows: enriched });
  } catch (err) {
    logger.error('getAlumniConnectionRequests:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to fetch connection requests') });
  }
};

/**
 * PATCH /placement/alumni/connection-requests/:id
 * Admin: update connection request status (approve/reject/contacted).
 */
exports.updateAlumniConnectionRequest = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid request ID.' });
    }

    const { status, po_remarks } = req.body;
    const validStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'CONTACTED'];
    if (!status || !validStatuses.includes(String(status).toUpperCase())) {
      return res.status(400).json({ message: 'Invalid status. Use PENDING, APPROVED, REJECTED, or CONTACTED.' });
    }

    const payload = {
      status: String(status).toUpperCase(),
      po_remarks: (po_remarks != null && String(po_remarks).trim()) ? String(po_remarks).trim() : null,
      decided_at: ['APPROVED', 'REJECTED'].includes(String(status).toUpperCase()) ? new Date().toISOString() : undefined,
      contacted_at: String(status).toUpperCase() === 'CONTACTED' ? new Date().toISOString() : undefined,
    };

    const data = await alumniDb.updateConnectionRequest(id, payload);
    if (!data) return res.status(404).json({ message: 'Request not found.' });

    res.json(data);
  } catch (err) {
    logger.error('updateAlumniConnectionRequest:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to update connection request') });
  }
};

/**
 * GET /placement/projects/alumni
 * Alumni: get all approved projects with like/favorite status for current user (same set as admin showcase).
 */
exports.getAlumniProjects = async (req, res) => {
  try {
    const userId = req.user ? (req.user.id || req.user.user_id) : null;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const projRes = await pool.query(
      `SELECT p.id, p.owner_usn, p.title, p.short_description, p.description, p.category,
        p.hosted_url, p.github_url, p.mentor_name, p.tech_stack, p.published_at, p.visibility
       FROM projects p
       LEFT JOIN project_metrics m ON m.project_id = p.id
       WHERE LOWER(TRIM(p.project_status::text)) = 'approved'
       ORDER BY COALESCE(m.likes, 0) DESC, COALESCE(m.views, 0) DESC
       LIMIT 100`
    );
    const rows = projRes.rows || [];
    const projectIds = rows.map((r) => r.id);

    let assetsByProj = {};
    let likedSet = new Set();
    let favoritedSet = new Set();
    if (projectIds.length > 0) {
      const [assetRes, likeRes, favRes] = await Promise.all([
        pool.query(
          `SELECT project_id, original_url, position
           FROM project_assets
           WHERE project_id = ANY($1::bigint[]) AND asset_role IN ('COVER','GALLERY')
           ORDER BY project_id, position`,
          [projectIds]
        ),
        pool.query(
          'SELECT project_id FROM project_likes WHERE project_id = ANY($1::bigint[]) AND user_id = $2',
          [projectIds, userId]
        ),
        pool.query(
          'SELECT project_id FROM project_favorites WHERE project_id = ANY($1::bigint[]) AND user_id = $2',
          [projectIds, userId]
        ),
      ]);
      (assetRes.rows || []).forEach((a) => {
        if (!assetsByProj[a.project_id]) assetsByProj[a.project_id] = [];
        assetsByProj[a.project_id].push(a.original_url);
      });
      (likeRes.rows || []).forEach((r) => likedSet.add(r.project_id));
      (favRes.rows || []).forEach((r) => favoritedSet.add(r.project_id));
    }

    const metricRes = await pool.query(
      'SELECT project_id, views, likes, favorites FROM project_metrics WHERE project_id = ANY($1::bigint[])',
      [projectIds]
    );
    const metricMap = {};
    (metricRes.rows || []).forEach((m) => { metricMap[m.project_id] = m; });

    const list = rows.map((p) => {
      const m = metricMap[p.id] || {};
      return {
        id: p.id,
        owner_usn: p.owner_usn,
        usn: p.owner_usn,
        title: p.title,
        short_description: p.short_description,
        one_line_description: p.short_description,
        description: p.description,
        full_description: p.description,
        category: p.category,
        genre: p.category,
        hosted_url: p.hosted_url,
        hosted_link: p.hosted_url,
        github_url: p.github_url,
        github_repo: p.github_url,
        mentor_name: p.mentor_name,
        tech_stack: Array.isArray(p.tech_stack) ? p.tech_stack : [],
        technologies: Array.isArray(p.tech_stack) ? p.tech_stack : [],
        published_at: p.published_at,
        project_snaps: assetsByProj[p.id] || [],
        cover_url: (assetsByProj[p.id] && assetsByProj[p.id][0]) || null,
        views_count: m.views ?? 0,
        likes_count: m.likes ?? 0,
        favorites_count: m.favorites ?? 0,
        is_liked: likedSet.has(p.id),
        is_favorited: favoritedSet.has(p.id),
      };
    });

    res.json(list);
  } catch (err) {
    logger.error('getAlumniProjects:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to fetch projects') });
  }
};

/**
 * GET /placement/projects/alumni/:projectId
 * Alumni: get single approved project by id (full detail like admin view – overview + reviews).
 */
exports.getAlumniProjectById = async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId, 10);
    if (Number.isNaN(projectId)) {
      return res.status(400).json({ message: 'Invalid project id.' });
    }
    const userId = req.user ? (req.user.id || req.user.user_id) : null;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const projRes = await pool.query(
      `SELECT p.id, p.owner_usn, p.title, p.short_description, p.description, p.category,
        p.hosted_url, p.github_url, p.mentor_name, p.tech_stack, p.published_at, p.project_status, p.created_at
       FROM projects p
       WHERE p.id = $1 AND LOWER(TRIM(p.project_status::text)) = 'approved'`,
      [projectId]
    );
    if (!projRes.rows.length) {
      return res.status(404).json({ message: 'Project not found.' });
    }
    const p = projRes.rows[0];

    const [assetRes, metricRes, reviewsRes, likeRes, favRes] = await Promise.all([
      pool.query(
        `SELECT project_id, original_url, position
         FROM project_assets
         WHERE project_id = $1 AND asset_role IN ('COVER','GALLERY')
         ORDER BY position`,
        [projectId]
      ),
      pool.query(
        'SELECT views, likes, favorites FROM project_metrics WHERE project_id = $1',
        [projectId]
      ),
      pool.query(
        `SELECT r.id, r.review_text, r.review_created_at, r.reply_text, r.reply_created_at, u.usn AS reviewer_usn
         FROM project_reviews r
         LEFT JOIN user_login u ON u.id = r.reviewer_id
         WHERE r.project_id = $1 ORDER BY r.review_created_at DESC`,
        [projectId]
      ),
      pool.query(
        'SELECT 1 FROM project_likes WHERE project_id = $1 AND user_id = $2',
        [projectId, userId]
      ),
      pool.query(
        'SELECT 1 FROM project_favorites WHERE project_id = $1 AND user_id = $2',
        [projectId, userId]
      ),
    ]);

    const assets = assetRes.rows || [];
    const metrics = metricRes.rows[0] || {};
    const reviews = (reviewsRes.rows || []).map((r) => ({
      id: r.id,
      reviewer_usn: r.reviewer_usn,
      review_text: r.review_text,
      review_created_at: r.review_created_at,
      reply_text: r.reply_text,
      reply_created_at: r.reply_created_at,
    }));
    const project_snaps = assets.map((a) => a.original_url);

    res.json({
      id: p.id,
      owner_usn: p.owner_usn,
      title: p.title,
      short_description: p.short_description,
      description: p.description,
      category: p.category,
      hosted_url: p.hosted_url,
      github_url: p.github_url,
      mentor_name: p.mentor_name,
      tech_stack: Array.isArray(p.tech_stack) ? p.tech_stack : [],
      tags: Array.isArray(p.tech_stack) ? p.tech_stack : [],
      project_status: p.project_status,
      created_at: p.created_at,
      project_snaps,
      assets: [],
      metrics: {
        views: metrics.views ?? 0,
        likes: metrics.likes ?? 0,
        favorites: metrics.favorites ?? 0,
        comments: reviews.length,
        last_updated: null,
      },
      reviews,
      share_links: [],
      views_count: metrics.views ?? 0,
      likes_count: metrics.likes ?? 0,
      favorites_count: metrics.favorites ?? 0,
      is_liked: (likeRes.rows || []).length > 0,
      is_favorited: (favRes.rows || []).length > 0,
    });
  } catch (err) {
    logger.error('getAlumniProjectById:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to fetch project') });
  }
};

/**
 * POST /placement/projects/:id/view
 * Record a unique view: one per (project_id, user_id) when logged in, or one per (project_id, ip_address) when anonymous.
 * Does not insert if this viewer already viewed this project; returns current view count.
 */
exports.incrementProjectView = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return res.status(400).json({ message: 'Invalid project id.' });
    }

    const userId = req.user ? (req.user.id || req.user.user_id) : null;
    const ipAddress = (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '').toString().split(',')[0].trim() || null;

    const projRes = await pool.query('SELECT id FROM projects WHERE id = $1', [projectId]);
    if (!projRes.rows.length) {
      return res.status(404).json({ message: 'Project not found.' });
    }

    let alreadyViewed = false;
    if (userId != null) {
      const exist = await pool.query(
        'SELECT 1 FROM project_views WHERE project_id = $1 AND user_id = $2 LIMIT 1',
        [projectId, userId]
      );
      alreadyViewed = exist.rows.length > 0;
    } else {
      const exist = await pool.query(
        'SELECT 1 FROM project_views WHERE project_id = $1 AND user_id IS NULL AND ip_address IS NOT DISTINCT FROM $2 LIMIT 1',
        [projectId, ipAddress]
      );
      alreadyViewed = exist.rows.length > 0;
    }

    if (!alreadyViewed) {
      await pool.query(
        'INSERT INTO project_views (project_id, user_id, ip_address) VALUES ($1, $2, $3)',
        [projectId, userId, ipAddress]
      );
      await pool.query(
        `INSERT INTO project_metrics (project_id, views, likes, favorites, comments, last_updated)
         VALUES ($1, 0, 0, 0, 0, NOW())
         ON CONFLICT (project_id) DO NOTHING`,
        [projectId]
      );
      await pool.query(
        'UPDATE project_metrics SET views = (SELECT COUNT(*)::int FROM project_views WHERE project_id = $1), last_updated = NOW() WHERE project_id = $1',
        [projectId]
      );
    }

    const metricRes = await pool.query('SELECT views FROM project_metrics WHERE project_id = $1', [projectId]);
    res.json({ views: metricRes.rows[0]?.views ?? 0 });
  } catch (err) {
    logger.error('incrementProjectView:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to increment view') });
  }
};

/**
 * POST /placement/projects/:id/like
 * Alumni/authenticated: toggle like on project.
 */
exports.toggleProjectLike = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (Number.isNaN(projectId)) {
      return res.status(400).json({ message: 'Invalid project id.' });
    }
    const userId = req.user ? (req.user.id || req.user.user_id) : null;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const projRes = await pool.query(
      'SELECT id, visibility, project_status FROM projects WHERE id = $1',
      [projectId]
    );
    if (!projRes.rows.length) {
      return res.status(404).json({ message: 'Project not found.' });
    }
    const p = projRes.rows[0];
    const canView = p.visibility === 'PUBLIC' || p.project_status === 'approved';
    if (!canView) {
      return res.status(404).json({ message: 'Project not found.' });
    }

    const existRes = await pool.query(
      'SELECT 1 FROM project_likes WHERE project_id = $1 AND user_id = $2',
      [projectId, userId]
    );
    const existed = !!existRes.rows.length;

    // Ensure project_metrics row exists (some projects may not have one)
    await pool.query(
      `INSERT INTO project_metrics (project_id, views, likes, favorites, comments, last_updated)
       VALUES ($1, 0, 0, 0, 0, NOW())
       ON CONFLICT (project_id) DO NOTHING`,
      [projectId]
    );

    if (existed) {
      await pool.query('DELETE FROM project_likes WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      await pool.query(
        'UPDATE project_metrics SET likes = GREATEST(0, likes - 1), last_updated = NOW() WHERE project_id = $1',
        [projectId]
      );
    } else {
      await pool.query(
        'INSERT INTO project_likes (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [projectId, userId]
      );
      await pool.query(
        'UPDATE project_metrics SET likes = likes + 1, last_updated = NOW() WHERE project_id = $1',
        [projectId]
      );
    }

    const metricRes = await pool.query('SELECT likes FROM project_metrics WHERE project_id = $1', [projectId]);
    const likes = metricRes.rows[0]?.likes ?? 0;
    res.json({ liked: !existed, likes });
  } catch (err) {
    logger.error('toggleProjectLike:', err);
    res.status(500).json({ message: apiMessage(err, 'Failed to toggle like') });
  }
};

