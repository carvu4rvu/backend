/**
 * Populate existing placement drives with realistic end-to-end simulation data.
 * Uses production schema only (PostgreSQL pool).
 *
 * Run from backend:
 *   node scripts/simulatePlacementDrives.js
 *   DRY_RUN=1 node scripts/simulatePlacementDrives.js
 *   SIM_SEED=42 node scripts/simulatePlacementDrives.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const SIM_SEED = parseInt(process.env.SIM_SEED || '20260518', 10);

/** Target status distribution (21 drives) */
const STATUS_PLAN = [
  ...Array(7).fill('Scheduled'),
  ...Array(5).fill('Ongoing'),
  ...Array(6).fill('Completed'),
  ...Array(2).fill('Postponed'),
  ...Array(1).fill('Failed'),
];

const ROUND_TEMPLATES = [
  ['OA', 'GD', 'Technical', 'Interview'],
  ['OA', 'Technical', 'Interview', 'HR'],
  ['OA', 'GD', 'Technical', 'Interview', 'HR'],
  ['OA', 'GD', 'Technical', 'HR'],
  ['OA', 'Technical', 'GD', 'Interview', 'HR'],
  ['OA', 'GD', 'Technical', 'Interview', 'HR', 'Final'],
].map((r) => r.filter((x) => x !== 'Final' && x !== 'Aptitude'));

const ROUND_TO_FIELD = {
  OA: 'oa_status',
  GD: 'gd_status',
  Technical: 'technical_round_status',
  Interview: 'interview_status',
  HR: 'hr_round_status',
};

const REGISTRATION_STATUSES = ['Registered', 'Pending', 'Not Registered'];
const APPROVED_STATUSES = ['Qualified', 'Not Qualified', 'Pending', 'skipped'];
const ATTENDANCE_VALUES = ['present', 'absent', null];
const OFFER_LETTER_STATUSES = ['Pending', 'Accepted', 'Rejected', 'Declined'];

const VIOLATION_TYPES = ['MALPRACTICE', 'NO_SHOW', 'MULTIPLE_OFFERS', 'FAKE_DOCUMENT'];
const DISCIPLINARY_TYPES = ['MISCONDUCT', 'HARASSMENT', 'ACADEMIC_INTEGRITY', 'DISCIPLINE'];
const DISCIPLINARY_SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL'];

const DESIGNATIONS_FT = [
  'Software Engineer',
  'Full Stack Developer',
  'Associate Engineer',
  'Graduate Engineer Trainee',
  'SDE I',
];
const DESIGNATIONS_INTERN = [
  'Software Development Intern',
  'Engineering Intern',
  'Technology Intern',
  'Product Intern',
];

/** Mulberry32 PRNG */
function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function chance(rng, p) {
  return rng() < p;
}

function addDays(d, days) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function iso(d) {
  return d.toISOString();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function inIntArray(arr, val) {
  if (!arr || !arr.length) return true;
  const v = typeof val === 'number' ? val : parseInt(val, 10);
  return !Number.isNaN(v) && arr.includes(v);
}

function evaluateEligibility(student, eligibility) {
  if (!eligibility) return { isEligible: true, reasons: [] };
  const reasons = [];
  if (eligibility.min_cgpa != null && student.latest_sgpa != null) {
    const sgpa = parseFloat(student.latest_sgpa);
    if (!Number.isNaN(sgpa) && sgpa < parseFloat(eligibility.min_cgpa)) {
      reasons.push('CGPA below minimum');
    }
  }
  if (eligibility.max_active_backlogs != null && (student.live_backlogs ?? 0) > eligibility.max_active_backlogs) {
    reasons.push('Active backlogs exceed limit');
  }
  if (eligibility.allowed_school_ids?.length && !inIntArray(eligibility.allowed_school_ids, student.school_id)) {
    reasons.push('School not allowed');
  }
  if (eligibility.allowed_program_ids?.length && !inIntArray(eligibility.allowed_program_ids, student.program_id)) {
    reasons.push('Program not allowed');
  }
  if (eligibility.graduation_years?.length && student.graduation_year != null) {
    if (!inIntArray(eligibility.graduation_years, student.graduation_year)) reasons.push('Graduation year');
  }
  return { isEligible: reasons.length === 0, reasons };
}

function jdRelevanceScore(student, jdText, jobType) {
  const jd = (jdText || '').toLowerCase();
  const prog = (student.program_name || '').toLowerCase();
  const major = (student.major_name || '').toLowerCase();
  const spec = (student.specialization_name || '').toLowerCase();
  let score = rngBase();

  const techProg =
    prog.includes('computer') ||
    prog.includes('information') ||
    prog.includes('software') ||
    prog.includes('cse') ||
    prog.includes('it');
  const dataHint = spec.includes('data') || prog.includes('data') || major.includes('data');

  if (jd.includes('full stack') || jd.includes('developer') || jd.includes('software')) {
    if (techProg) score += 3;
    if (major.includes('software') || major.includes('computer')) score += 1.5;
  }
  if (jd.includes('intern') || (jobType || '').toLowerCase().includes('intern')) {
    if ((student.current_year ?? 4) <= 3) score += 2;
    if (techProg) score += 1;
  }
  if (jd.includes('data') || jd.includes('analytics') || jd.includes('ml')) {
    if (dataHint) score += 3;
  }
  if (jd.includes('mobility') || jd.includes('embedded')) {
    if (prog.includes('electronic') || prog.includes('ece')) score += 2.5;
  }
  if (jd.includes('bio') || jd.includes('syntra')) {
    if (prog.includes('bio') || spec.includes('bio')) score += 2.5;
  }
  return score;
}

let rngBase = () => Math.random();

function buildEligibilityCriteria(drive, schools, programs, rng) {
  const schoolCount = 1 + Math.floor(rng() * 3);
  const shuffledSchools = [...schools].sort(() => rng() - 0.5);
  const allowedSchoolIds = shuffledSchools.slice(0, schoolCount).map((s) => Number(s.id));
  const allowedProgramIds = programs
    .filter((p) => allowedSchoolIds.includes(Number(p.school_id)))
    .map((p) => Number(p.id));
  const minCgpa = [6.0, 6.5, 7.0, 7.5, 8.0][Math.floor(rng() * 5)];
  const maxBacklogs = rng() < 0.7 ? 0 : rng() < 0.5 ? 1 : 2;
  const gradYears = [2025, 2026, 2027].filter(() => chance(rng, 0.85));
  return {
    min_cgpa: minCgpa,
    max_active_backlogs: maxBacklogs,
    max_backlog_history: maxBacklogs === 0 ? 2 : 5,
    allowed_school_ids: allowedSchoolIds,
    allowed_program_ids: allowedProgramIds.length ? allowedProgramIds : undefined,
    graduation_years: gradYears.length ? gradYears : [2026],
    admin_override_allowed: chance(rng, 0.15),
  };
}

function datesForStatus(status, idx, rng) {
  const now = new Date();
  switch (status) {
    case 'Scheduled':
      return {
        last_date_to_registration: iso(addDays(now, 4 + idx * 2)),
        event_datetime: iso(addDays(now, 12 + idx * 3)),
      };
    case 'Ongoing':
      return {
        last_date_to_registration: iso(addDays(now, -(8 + idx))),
        event_datetime: iso(addDays(now, 3 + idx * 2)),
      };
    case 'Completed':
      return {
        last_date_to_registration: iso(addDays(now, -(45 + idx * 4))),
        event_datetime: iso(addDays(now, -(20 + idx * 3))),
      };
    case 'Postponed':
      return {
        last_date_to_registration: iso(addDays(now, 20 + idx * 5)),
        event_datetime: iso(addDays(now, 35 + idx * 5)),
      };
    case 'Failed':
    default:
      return {
        last_date_to_registration: iso(addDays(now, -(30 + idx))),
        event_datetime: iso(addDays(now, -(15 + idx))),
      };
  }
}

function defaultCtc(jobType, rng) {
  const isIntern = (jobType || '').toLowerCase().includes('intern') && !(jobType || '').includes('+');
  if (isIntern) {
    const min = 15000 + Math.floor(rng() * 15000);
    const max = min + 10000 + Math.floor(rng() * 20000);
    return {
      ctc_structure: null,
      stipend_structure: { min, max, currency: 'INR', period: 'monthly' },
    };
  }
  const bands = [
    { min: 8, max: 14 },
    { min: 12, max: 18 },
    { min: 18, max: 28 },
    { min: 22, max: 35 },
    { min: 28, max: 45 },
  ];
  const b = pick(rng, bands);
  return {
    ctc_structure: {
      min_lpa: b.min,
      max_lpa: b.max,
      variable_pay_percent: 8 + Math.floor(rng() * 12),
      stock_lpa: chance(rng, 0.4) ? 1 + rng() * 5 : 0,
    },
    stipend_structure: null,
  };
}

/**
 * Simulate funnel for one student on a drive.
 */
function simulateStudentProcess({ rounds, driveStatus, rng, forceMalpractice }) {
  const fields = {
    oa_status: null,
    gd_status: null,
    technical_round_status: null,
    interview_status: null,
    hr_round_status: null,
    final_select_status: false,
    malpractice: false,
    attendance: null,
    remarks: null,
  };

  const withdrawn = chance(rng, 0.04);
  const absent = !withdrawn && chance(rng, 0.06);

  let registration_status = 'Registered';
  if (withdrawn) {
    registration_status = chance(rng, 0.5) ? 'Not Registered' : 'Registered';
    fields.remarks = 'Withdrawn from drive';
    fields.attendance = 'absent';
    return {
      ...fields,
      registration_status,
      approved_status: 'Pending',
      is_eligible: true,
    };
  }

  if (absent) fields.attendance = 'absent';
  else if (chance(rng, 0.85)) fields.attendance = 'present';

  const regPending = driveStatus === 'Scheduled' && chance(rng, 0.25);
  if (regPending) registration_status = pick(rng, ['Pending', 'Registered']);

  const eligibleRoll = chance(rng, 0.88);
  const is_eligible = eligibleRoll;
  let approved_status = is_eligible
    ? chance(rng, 0.08)
      ? 'Not Qualified'
      : chance(rng, 0.05)
        ? 'Pending'
        : 'Qualified'
    : 'Not Qualified';

  if (driveStatus === 'Postponed' || driveStatus === 'Failed') {
    return {
      ...fields,
      registration_status,
      approved_status: is_eligible ? 'Pending' : 'Not Qualified',
      is_eligible,
    };
  }

  if (driveStatus === 'Scheduled') {
    return {
      ...fields,
      registration_status,
      approved_status,
      is_eligible,
    };
  }

  if (approved_status !== 'Qualified') {
    return { ...fields, registration_status, approved_status, is_eligible };
  }

  /** Target funnel (Completed): ~80% eligible → ~65% OA → ~62% tech → ~62% HR → ~15% final vs registered */
  const passRates =
    driveStatus === 'Completed'
      ? [0.68, 0.62, 0.58, 0.55, 0.5]
      : driveStatus === 'Ongoing'
        ? [0.6, 0.5, 0.42, 0.35, 0.28]
        : [0.55, 0.45, 0.35, 0.28, 0.2];

  let stopped = false;
  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    const field = ROUND_TO_FIELD[round];
    if (!field || stopped) continue;

    const rate = passRates[Math.min(i, passRates.length - 1)];
    const passed = chance(rng, rate);
    fields[field] = passed;

    if (!passed) {
      stopped = true;
      if (forceMalpractice && round === 'OA') {
        fields.malpractice = true;
        fields.remarks = 'Malpractice flagged during online assessment';
      } else if (chance(rng, 0.15)) {
        fields.remarks = `Did not clear ${round} round`;
      }
    }
  }

  const lastRound = rounds[rounds.length - 1];
  const lastField = ROUND_TO_FIELD[lastRound];
  const clearedAll =
    !stopped &&
    rounds.every((r) => {
      const f = ROUND_TO_FIELD[r];
      return f ? fields[f] === true : true;
    });

  const hrOrFinalCleared =
    fields.hr_round_status === true ||
    fields.interview_status === true ||
    (lastField && fields[lastField] === true);

  if (driveStatus === 'Completed' && hrOrFinalCleared) {
    fields.final_select_status = chance(rng, 0.38);
  } else if (clearedAll && driveStatus === 'Ongoing' && chance(rng, 0.22)) {
    fields.final_select_status = true;
  } else if (hrOrFinalCleared && driveStatus === 'Ongoing' && chance(rng, 0.08)) {
    fields.final_select_status = true;
  }

  if (forceMalpractice && !fields.malpractice) {
    fields.malpractice = true;
    fields.remarks = 'Malpractice / policy violation during process';
    fields.final_select_status = false;
    const clearFrom = Math.floor(rng() * rounds.length);
    rounds.slice(clearFrom).forEach((r) => {
      const f = ROUND_TO_FIELD[r];
      if (f) fields[f] = false;
    });
  }

  return {
    ...fields,
    registration_status,
    approved_status,
    is_eligible,
  };
}

async function resolveAcademicsTable(client) {
  const { rows } = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'student_semester_records') AS has_records,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'student_semester_academics') AS has_legacy`
  );
  if (rows[0]?.has_records) return 'student_semester_records';
  return 'student_semester_academics';
}

async function loadEligibleStudentPool(client, academicsTable) {
  const useRecords = academicsTable === 'student_semester_records';
  const latestSgpaExpr = useRecords ? 'COALESCE(cgpa, sgpa)' : 'result_in_sgpa';
  const liveBacklogsExpr = useRecords ? 'COALESCE(active_backlogs, 0)' : 'COALESCE(live_backlogs, 0)';

  const { rows } = await client.query(
    `SELECT
       s.usn, s.full_name, s.school_id, s.program_id, s.major_id, s.specialization_id,
       s.year_of_joining, s.current_year, s.current_semester, s.gender, s.opt_in,
       s.is_placement_eligible,
       sch.name AS school_name,
       prg.name AS program_name, prg.max_duration_years,
       maj.name AS major_name,
       spc.name AS specialization_name,
       ac.latest_sgpa, ac.live_backlogs,
       (s.year_of_joining + COALESCE(prg.max_duration_years, 4)) AS graduation_year
     FROM student_basic_details s
     INNER JOIN user_login ul ON ul.usn = s.usn AND ul.is_active = true
     LEFT JOIN student_edit_control sec ON sec.usn = s.usn
     LEFT JOIN schools sch ON sch.id = s.school_id
     LEFT JOIN programs prg ON prg.id = s.program_id
     LEFT JOIN majors maj ON maj.id = s.major_id
     LEFT JOIN specializations spc ON spc.id = s.specialization_id
     LEFT JOIN LATERAL (
       SELECT (${latestSgpaExpr})::float AS latest_sgpa,
              (${liveBacklogsExpr})::int AS live_backlogs
       FROM public.${academicsTable} r
       WHERE r.usn = s.usn
       ORDER BY r.academic_year DESC NULLS LAST, r.semester DESC NULLS LAST
       LIMIT 1
     ) ac ON true
     WHERE s.opt_in = true
       AND COALESCE(sec.is_placements_locked, false) = false
       AND NOT EXISTS (
         SELECT 1 FROM student_placement_violations spv
         WHERE spv.usn = s.usn AND spv.is_active = true
       )
       AND NOT EXISTS (
         SELECT 1 FROM student_disciplinary_records sdr
         WHERE sdr.usn = s.usn AND sdr.is_active = true
       )
     ORDER BY s.usn`
  );
  return rows;
}

async function bulkInsertProcess(client, processRows) {
  let inserted = 0;
  for (const batch of chunk(processRows, 400)) {
    const cols = [
      'placement_drive_id',
      'usn',
      'is_eligible',
      'registration_status',
      'approved_status',
      'oa_status',
      'gd_status',
      'technical_round_status',
      'interview_status',
      'hr_round_status',
      'final_select_status',
      'malpractice',
      'remarks',
      'attendance',
    ];
    const values = [];
    const params = [];
    let idx = 1;
    batch.forEach((r) => {
      values.push(
        `($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6},$${idx + 7},$${idx + 8},$${idx + 9},$${idx + 10},$${idx + 11},$${idx + 12},$${idx + 13})`
      );
      params.push(
        r.placement_drive_id,
        r.usn,
        r.is_eligible,
        r.registration_status,
        r.approved_status,
        r.oa_status,
        r.gd_status,
        r.technical_round_status,
        r.interview_status,
        r.hr_round_status,
        r.final_select_status,
        r.malpractice,
        r.remarks,
        r.attendance
      );
      idx += 14;
    });
    const sql = `INSERT INTO student_placement_process (${cols.join(', ')}) VALUES ${values.join(', ')}`;
    const res = await client.query(sql, params);
    inserted += res.rowCount || batch.length;
  }
  return inserted;
}

async function bulkInsertViolations(client, rows) {
  let n = 0;
  for (const batch of chunk(rows, 200)) {
    const cols = [
      'usn',
      'placement_drive_id',
      'violation_type',
      'penalty_type',
      'penalty_days',
      'is_active',
      'remarks',
    ];
    const values = [];
    const params = [];
    let idx = 1;
    batch.forEach((r) => {
      values.push(`($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6})`);
      params.push(
        r.usn,
        r.placement_drive_id,
        r.violation_type,
        r.penalty_type,
        r.penalty_days ?? null,
        true,
        r.remarks
      );
      idx += 7;
    });
    const res = await client.query(
      `INSERT INTO student_placement_violations (${cols.join(', ')}) VALUES ${values.join(', ')}`,
      params
    );
    n += res.rowCount || batch.length;
  }
  return n;
}

async function bulkInsertDisciplinary(client, rows) {
  let n = 0;
  for (const batch of chunk(rows, 200)) {
    const cols = ['usn', 'violation_type', 'severity', 'description', 'is_active', 'start_date', 'end_date'];
    const values = [];
    const params = [];
    let idx = 1;
    batch.forEach((r) => {
      values.push(`($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6})`);
      params.push(r.usn, r.violation_type, r.severity, r.description, true, r.start_date, r.end_date ?? null);
      idx += 7;
    });
    const res = await client.query(
      `INSERT INTO student_disciplinary_records (${cols.join(', ')}) VALUES ${values.join(', ')}`,
      params
    );
    n += res.rowCount || batch.length;
  }
  return n;
}

function offerPackageForDrive(drive, rng) {
  const jt = (drive.job_type || '').toLowerCase();
  const isIntern = jt.includes('intern') && !jt.includes('+');
  const isPpo = jt.includes('+') || jt.includes('fte');
  if (isIntern) {
    const stip = drive.stipend_structure || {};
    const min = Number(stip.min) || 20000;
    const max = Number(stip.max) || min + 15000;
    return { kind: 'intern', stipendMin: min, stipendMax: max };
  }
  const ctc = drive.ctc_structure || {};
  const min = Number(ctc.min_lpa) || 10;
  const max = Number(ctc.max_lpa) || min + 8;
  return { kind: isPpo ? 'ppo' : 'fte', ctcMin: min, ctcMax: max };
}

async function createOfferBundle(client, { usn, companyId, companyName, drive, pkg, rng, offCampus }) {
  const academicYear = drive.academic_year || '2025-26';
  let placementId = null;
  let capstoneId = null;
  let jobType = 'full time';

  if (pkg.kind === 'intern') {
    const capRes = await client.query(
      `INSERT INTO capstone (
         usn, company_name, internship_duration_months, designation, offer_letter_status,
         internship_stipend_min, internship_stipend_max, description, academic_year, remarks
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        usn,
        companyName || 'Off-Campus Company',
        2 + Math.floor(rng() * 4),
        pick(rng, DESIGNATIONS_INTERN),
        pick(rng, OFFER_LETTER_STATUSES),
        pkg.stipendMin,
        pkg.stipendMax,
        drive.job_description ? String(drive.job_description).slice(0, 500) : null,
        academicYear,
        offCampus ? 'Off-campus internship offer' : 'Campus internship offer',
      ]
    );
    capstoneId = capRes.rows[0].id;
    jobType = 'internship';
  } else {
    const spread = pkg.ctcMax - pkg.ctcMin;
    const ctcMin = pkg.ctcMin + rng() * spread * 0.3;
    const ctcMax = pkg.ctcMax - rng() * spread * 0.2;
    const plRes = await client.query(
      `INSERT INTO placement (
         student_id, company_id, designation, offer_letter_status, job_description,
         ctc_min_lpa, ctc_max_lpa, ctc_variable_pay, ctc_stock_in_lpa, type_of_hiring, academic_year, remarks
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        usn,
        offCampus ? null : companyId,
        pick(rng, DESIGNATIONS_FT),
        pick(rng, OFFER_LETTER_STATUSES),
        drive.job_description ? String(drive.job_description).slice(0, 500) : null,
        Number(ctcMin.toFixed(2)),
        Number(ctcMax.toFixed(2)),
        chance(rng, 0.6) ? 8 + Math.floor(rng() * 10) : null,
        chance(rng, 0.25) ? Number((1 + rng() * 8).toFixed(2)) : null,
        pkg.kind === 'ppo' ? 'Internship + Full Time' : 'Full Time',
        academicYear,
        offCampus ? 'Off-campus placement' : null,
      ]
    );
    placementId = plRes.rows[0].id;
    jobType = pkg.kind === 'ppo' ? 'Internship + Full Time' : 'full time';
  }

  const offerRes = await client.query(
    `INSERT INTO offers (student_id, company_id, placement_id, capstone_id, job_type, academic_year, remarks, is_accepted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      usn,
      offCampus ? null : companyId,
      placementId,
      capstoneId,
      jobType,
      academicYear,
      offCampus ? 'Off-campus offer (simulation)' : 'Campus offer (simulation)',
      chance(rng, 0.72),
    ]
  );
  return offerRes.rows[0].id;
}

async function main() {
  const rng = createRng(SIM_SEED);
  rngBase = () => rng();

  const stats = {
    drivesUpdated: 0,
    processInserted: 0,
    violationsInserted: 0,
    disciplinaryInserted: 0,
    offersCreated: 0,
    studentsSelected: 0,
    statusDistribution: {},
    funnel: { registered: 0, eligible: 0, oa: 0, tech: 0, hr: 0, final: 0 },
    timings: [],
  };

  const time = async (label, fn) => {
    const t0 = Date.now();
    const result = await fn();
    const ms = Date.now() - t0;
    stats.timings.push({ label, ms });
    console.log(`[timing] ${label}: ${ms}ms`);
    return result;
  };

  console.log(`=== Placement drive simulation ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
  console.log(`Seed: ${SIM_SEED}\n`);

  const client = await pool.connect();
  try {
    await time('BEGIN', () => client.query('BEGIN'));

    const academicsTable = await resolveAcademicsTable(client);
    console.log(`Academics table: ${academicsTable}`);

    const [drivesRes, schoolsRes, programsRes, companiesRes] = await Promise.all([
      client.query(
        `SELECT pd.*, c.company_name
         FROM placements_drives pd
         LEFT JOIN companies c ON c.id = pd.company_id
         ORDER BY pd.id ASC`
      ),
      client.query('SELECT id, name FROM schools ORDER BY id'),
      client.query('SELECT id, name, school_id FROM programs ORDER BY school_id, id'),
      client.query('SELECT id, company_name FROM companies ORDER BY id'),
    ]);

    const drives = drivesRes.rows;
    const schools = schoolsRes.rows;
    const programs = programsRes.rows;
    const companies = companiesRes.rows;

    if (drives.length === 0) {
      console.log('No drives found.');
      await client.query('ROLLBACK');
      return;
    }

    const studentPool = await time('load student pool', () => loadEligibleStudentPool(client, academicsTable));
    console.log(`Eligible opt-in pool (excl. violations/discipline/locked/inactive): ${studentPool.length}`);

    if (studentPool.length < 30) {
      throw new Error('Not enough eligible students in pool (need at least 30)');
    }

    const driveIds = drives.map((d) => Number(d.id));

    if (!DRY_RUN) {
      await time('clear prior simulation offers', async () => {
        await client.query(`DELETE FROM offers WHERE remarks ILIKE '%(simulation)%'`);
        await client.query(
          `DELETE FROM placement p
           WHERE NOT EXISTS (SELECT 1 FROM offers o WHERE o.placement_id = p.id)
             AND (p.remarks ILIKE '%simulation%' OR p.remarks ILIKE '%Off-campus%')`
        );
        await client.query(
          `DELETE FROM capstone c
           WHERE NOT EXISTS (SELECT 1 FROM offers o WHERE o.capstone_id = c.id)
             AND c.remarks ILIKE '%simulation%'`
        );
      });
      await time('clear process rows', async () => {
        const del = await client.query(
          `DELETE FROM student_placement_process WHERE placement_drive_id = ANY($1::bigint[])`,
          [driveIds]
        );
        return del.rowCount;
      });
    } else {
      console.log(`[dry-run] Would delete process rows for ${driveIds.length} drives`);
    }

    const usedUsnsGlobal = new Set();
    const allProcessRows = [];
    const violationRows = [];
    const disciplinaryRows = [];
    const offerCandidates = [];

    for (let i = 0; i < drives.length; i++) {
      const drive = drives[i];
      const driveId = Number(drive.id);
      const status = STATUS_PLAN[i] || 'Scheduled';
      const rounds = ROUND_TEMPLATES[i % ROUND_TEMPLATES.length];
      const eligibility = buildEligibilityCriteria(drive, schools, programs, rng);
      const dates = datesForStatus(status, i, rng);
      const comp = defaultCtc(drive.job_type, rng);
      const openings = 15 + Math.floor(rng() * 40);

      if (!DRY_RUN) {
        await client.query(
          `UPDATE placements_drives SET
             placement_status = $2,
             process_rounds = $3::text[],
             eligibility_criteria = $4::jsonb,
             last_date_to_registration = $5::timestamptz,
             event_datetime = $6::timestamptz,
             number_of_openings = $7,
             ctc_structure = COALESCE(ctc_structure, $8::jsonb),
             stipend_structure = COALESCE(stipend_structure, $9::jsonb),
             updated_at = NOW()
           WHERE id = $1`,
          [
            driveId,
            status,
            rounds,
            JSON.stringify(eligibility),
            dates.last_date_to_registration,
            dates.event_datetime,
            openings,
            comp.ctc_structure ? JSON.stringify(comp.ctc_structure) : null,
            comp.stipend_structure ? JSON.stringify(comp.stipend_structure) : null,
          ]
        );
      }

      stats.drivesUpdated += 1;
      stats.statusDistribution[status] = (stats.statusDistribution[status] || 0) + 1;

      const targetCount = 30 + Math.floor(rng() * 71);
      const scored = studentPool
        .map((s) => {
          const { isEligible } = evaluateEligibility(s, eligibility);
          const jdScore = jdRelevanceScore(s, drive.job_description, drive.job_type);
          return { ...s, isEligible, jdScore };
        })
        .filter((s) => s.isEligible)
        .sort((a, b) => b.jdScore - a.jdScore || a.usn.localeCompare(b.usn));

      const eligibleList = scored.length >= targetCount ? scored : studentPool.map((s) => ({
        ...s,
        isEligible: evaluateEligibility(s, eligibility).isEligible,
        jdScore: jdRelevanceScore(s, drive.job_description, drive.job_type),
      })).filter((s) => s.isEligible).sort((a, b) => b.jdScore - a.jdScore);

      const picked = [];
      const pickedSet = new Set();
      for (const s of eligibleList) {
        if (picked.length >= targetCount) break;
        if (pickedSet.has(s.usn)) continue;
        picked.push(s);
        pickedSet.add(s.usn);
      }
      if (picked.length < targetCount) {
        for (const s of studentPool) {
          if (picked.length >= targetCount) break;
          if (pickedSet.has(s.usn)) continue;
          picked.push({ ...s, isEligible: true, jdScore: 0 });
          pickedSet.add(s.usn);
        }
      }

      const malpracticeUsns = new Set();
      const violTarget = Math.max(1, Math.floor(picked.length * 0.05));
      for (let v = 0; v < violTarget; v++) {
        const st = pick(rng, picked);
        malpracticeUsns.add(st.usn);
      }

      const driveProcessRows = [];

      for (const s of picked) {
        const forceMalpractice = malpracticeUsns.has(s.usn);
        const proc = simulateStudentProcess({
          rounds,
          driveStatus: status,
          rng,
          forceMalpractice,
        });
        if (proc.registration_status) stats.funnel.registered += 1;
        if (proc.is_eligible) stats.funnel.eligible += 1;
        if (proc.oa_status === true) stats.funnel.oa += 1;
        if (proc.technical_round_status === true) stats.funnel.tech += 1;
        if (proc.hr_round_status === true) stats.funnel.hr += 1;
        if (proc.final_select_status === true) stats.funnel.final += 1;

        const row = { placement_drive_id: driveId, usn: s.usn, ...proc };
        driveProcessRows.push({ row, jdScore: s.jdScore });
        usedUsnsGlobal.add(s.usn);

        if (forceMalpractice) {
          violationRows.push({
            usn: s.usn,
            placement_drive_id: driveId,
            violation_type: pick(rng, VIOLATION_TYPES),
            penalty_type: pick(rng, ['WARNING', 'TEMP_BAN', 'PERMANENT_BAN']),
            penalty_days: chance(rng, 0.4) ? 30 + Math.floor(rng() * 60) : null,
            remarks: 'Simulation: malpractice / process violation',
          });
          if (chance(rng, 0.35)) {
            disciplinaryRows.push({
              usn: s.usn,
              violation_type: pick(rng, DISCIPLINARY_TYPES),
              severity: pick(rng, DISCIPLINARY_SEVERITIES),
              description: 'Simulation disciplinary record linked to placement process',
              start_date: new Date().toISOString().slice(0, 10),
              end_date: chance(rng, 0.5) ? addDays(new Date(), 90).toISOString().slice(0, 10) : null,
            });
          }
        }
      }

      /** Completed drives: ensure ~12–18% selection rate with JD-relevant students preferred */
      if (status === 'Completed' && driveProcessRows.length > 0) {
        const selectCount = Math.max(
          2,
          Math.min(
            Math.floor(driveProcessRows.length * 0.18),
            Math.ceil(driveProcessRows.length * 0.12) + Math.floor(rng() * 4)
          )
        );
        const finalists = [...driveProcessRows]
          .filter((d) => !d.row.malpractice && d.row.is_eligible !== false)
          .sort((a, b) => b.jdScore - a.jdScore)
          .slice(0, selectCount);
        finalists.forEach(({ row }) => {
          row.registration_status = 'Registered';
          row.approved_status = 'Qualified';
          row.is_eligible = true;
          rounds.forEach((r) => {
            const f = ROUND_TO_FIELD[r];
            if (f) row[f] = true;
          });
          row.final_select_status = true;
          row.attendance = row.attendance || 'present';
        });
      }

      driveProcessRows.forEach(({ row }) => {
        if (row.final_select_status === true) {
          stats.studentsSelected += 1;
          if (status === 'Completed' || (status === 'Ongoing' && chance(rng, 0.55))) {
            offerCandidates.push({
              usn: row.usn,
              driveId,
              drive: {
                ...drive,
                ctc_structure: comp.ctc_structure || drive.ctc_structure,
                stipend_structure: comp.stipend_structure || drive.stipend_structure,
              },
              companyId: drive.company_id,
              companyName: drive.company_name,
            });
          }
        }
        allProcessRows.push(row);
      });

      if (!DRY_RUN) {
        await client.query(
          `UPDATE placements_drives SET number_of_registrations = $2, updated_at = NOW() WHERE id = $1`,
          [driveId, picked.length]
        );
      }

      console.log(
        `Drive ${driveId} [${status}]: ${picked.length} students, rounds=[${rounds.join(',')}], JD="${(drive.job_description || '').slice(0, 50)}..."`
      );
    }

    if (!DRY_RUN && allProcessRows.length) {
      stats.processInserted = await time('insert process rows', () => bulkInsertProcess(client, allProcessRows));
    } else {
      stats.processInserted = allProcessRows.length;
      console.log(`[dry-run] Would insert ${allProcessRows.length} process rows`);
    }

    const uniqueViol = [];
    const violKeys = new Set();
    for (const v of violationRows) {
      const key = `${v.usn}:${v.placement_drive_id}`;
      if (violKeys.has(key)) continue;
      violKeys.add(key);
      uniqueViol.push(v);
    }

    if (!DRY_RUN && uniqueViol.length) {
      stats.violationsInserted = await time('insert violations', () => bulkInsertViolations(client, uniqueViol));
    } else {
      stats.violationsInserted = uniqueViol.length;
    }

    const uniqueDisc = [];
    const discKeys = new Set();
    for (const d of disciplinaryRows) {
      if (discKeys.has(d.usn)) continue;
      discKeys.add(d.usn);
      uniqueDisc.push(d);
    }
    if (!DRY_RUN && uniqueDisc.length) {
      stats.disciplinaryInserted = await time('insert disciplinary', () =>
        bulkInsertDisciplinary(client, uniqueDisc)
      );
    } else {
      stats.disciplinaryInserted = uniqueDisc.length;
    }

    const offerKeys = new Set();
    for (const oc of offerCandidates) {
      const key = `${oc.usn}:${oc.driveId}`;
      if (offerKeys.has(key)) continue;
      offerKeys.add(key);
      if (DRY_RUN) {
        stats.offersCreated += 1;
        continue;
      }
      const pkg = offerPackageForDrive(oc.drive, rng);
      await createOfferBundle(client, {
        usn: oc.usn,
        companyId: oc.companyId,
        companyName: oc.companyName,
        drive: oc.drive,
        pkg,
        rng,
        offCampus: false,
      });
      stats.offersCreated += 1;

      if (chance(rng, 0.12) && companies.length > 1) {
        const alt = pick(rng, companies.filter((c) => String(c.id) !== String(oc.companyId)));
        if (alt) {
          await createOfferBundle(client, {
            usn: oc.usn,
            companyId: alt.id,
            companyName: alt.company_name,
            drive: { ...oc.drive, job_type: 'Full Time' },
            pkg: { kind: 'fte', ctcMin: 10, ctcMax: 18 },
            rng,
            offCampus: false,
          });
          stats.offersCreated += 1;
        }
      }
    }

    const offCampusCount = Math.max(3, Math.floor(offerCandidates.length * 0.04));
    const offCampusPool = [...usedUsnsGlobal].sort(() => rng() - 0.5).slice(0, offCampusCount);
    for (const usn of offCampusPool) {
      if (DRY_RUN) {
        stats.offersCreated += 1;
        continue;
      }
      await createOfferBundle(client, {
        usn,
        companyId: null,
        companyName: pick(rng, ['External Tech Corp', 'StartupXYZ', 'Global Systems Ltd']),
        drive: { academic_year: '2025-26', job_description: 'Off-campus opportunity', job_type: 'Full Time' },
        pkg: { kind: 'fte', ctcMin: 6, ctcMax: 12 },
        rng,
        offCampus: true,
      });
      stats.offersCreated += 1;
    }

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\n[DRY RUN] Rolled back — no changes committed.');
    } else {
      await time('COMMIT', () => client.query('COMMIT'));
    }

    console.log('\n========== SIMULATION SUMMARY ==========');
    console.log(`Drives updated:        ${stats.drivesUpdated}`);
    console.log(`Process rows:          ${stats.processInserted}`);
    console.log(`Violations inserted:   ${stats.violationsInserted}`);
    console.log(`Disciplinary inserted: ${stats.disciplinaryInserted}`);
    console.log(`Offers created:        ${stats.offersCreated}`);
    console.log(`Students selected:     ${stats.studentsSelected}`);
    console.log('Status distribution:', stats.statusDistribution);
    console.log('Funnel (approx):', stats.funnel);
    console.log('SQL timings:', stats.timings);
    console.log('========================================\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Simulation failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
