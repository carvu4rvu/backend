/**
 * Audit and repair ALL completed/closed placement drives:
 * - Ensures 50–100 registered students per drive (min 30)
 * - Full round progression (Registered → Approved → OA → … → Final)
 * - UI-compatible statuses (Registered + Qualified + boolean round fields)
 * - Job offers for final-selected students (same company as drive)
 *
 * Run: node scripts/repairCompletedDrives.js
 *      DRY_RUN=1 node scripts/repairCompletedDrives.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../config/db');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const REPAIR_SEED = parseInt(process.env.REPAIR_SEED || '20260518', 10);

/** Maps round label → DB column (must match DriveProcess.jsx ROUND_TO_FIELD) */
const ROUND_TO_FIELD = {
  OA: 'oa_status',
  GD: 'gd_status',
  Technical: 'technical_round_status',
  'Technical Round 1': 'technical_round_status',
  'Technical Round 2': 'interview_status',
  Interview: 'interview_status',
  HR: 'hr_round_status',
};

const STANDARD_ROUND_SETS = [
  ['OA', 'GD', 'Technical', 'Interview', 'HR'],
  ['OA', 'GD', 'Technical', 'HR'],
  ['OA', 'Technical', 'Interview', 'HR'],
  ['OA', 'GD', 'Technical Round 1', 'Technical Round 2', 'HR'],
  ['OA', 'GD', 'Technical', 'Interview'],
];

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

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function mapRoundsToFields(rounds) {
  return rounds.map((r) => ({ label: r, field: ROUND_TO_FIELD[r] })).filter((x) => x.field);
}

function normalizeProcessRounds(existing, rng) {
  const arr = Array.isArray(existing) ? existing.filter(Boolean) : [];
  const mapped = mapRoundsToFields(arr);
  if (mapped.length >= 4) return arr.filter((r) => ROUND_TO_FIELD[r]);
  return STANDARD_ROUND_SETS[Math.floor(rng() * STANDARD_ROUND_SETS.length)];
}

/**
 * Build funnel tier counts for N registered students.
 * Target: ~80 reg → ~70 approved → ~55 OA → ~40 GD → ~25 tech → ~15 HR → ~10 final
 */
function computeFunnelCounts(nRegistered, roundCount, rng) {
  const nApproved = Math.max(1, Math.floor(nRegistered * (0.86 + rng() * 0.06)));
  const ratios = [0.68, 0.72, 0.62, 0.58, 0.55];
  const tierCounts = [nApproved];
  for (let i = 0; i < roundCount; i++) {
    const prev = tierCounts[tierCounts.length - 1];
    tierCounts.push(Math.max(0, Math.floor(prev * (ratios[i] ?? 0.55))));
  }
  const nFinal = Math.max(
    3,
    Math.min(Math.floor(nRegistered * 0.14), tierCounts[tierCounts.length - 1] || 0)
  );
  return { nApproved, tierCounts, nFinal };
}

function jdRelevanceScore(student, jdText, jobType) {
  const jd = (jdText || '').toLowerCase();
  const prog = (student.program_name || '').toLowerCase();
  let score = Math.random();
  if (jd.includes('developer') || jd.includes('full stack')) {
    if (prog.includes('computer') || prog.includes('information') || prog.includes('software')) score += 3;
  }
  if (jd.includes('intern') || (jobType || '').toLowerCase().includes('intern')) {
    if ((student.current_year ?? 4) <= 3) score += 2;
  }
  return score;
}

function buildProcessRow(usn, driveId, rounds, slot, rng) {
  const fields = {
    oa_status: null,
    gd_status: null,
    technical_round_status: null,
    interview_status: null,
    hr_round_status: null,
    final_select_status: false,
    malpractice: false,
    attendance: chance(rng, 0.92) ? 'present' : 'absent',
    remarks: null,
  };

  const row = {
    placement_drive_id: driveId,
    usn,
    is_eligible: true,
    registration_status: 'Registered',
    approved_status: slot.inFunnel ? 'Qualified' : pick(rng, ['Not Qualified', 'Pending']),
    ...fields,
  };

  if (!slot.inFunnel) {
    if (chance(rng, 0.1)) row.remarks = 'Not approved for process';
    return row;
  }

  const fieldOrder = mapRoundsToFields(rounds).map((x) => x.field);
  const uniqueFields = [...new Set(fieldOrder)];

  for (let i = 0; i < uniqueFields.length; i++) {
    const field = uniqueFields[i];
    if (i < slot.roundsPassed) {
      row[field] = true;
    } else if (i === slot.roundsPassed && slot.failed) {
      row[field] = false;
      if (slot.malpractice) {
        row.malpractice = true;
        row.remarks = 'Malpractice flagged in round';
      } else {
        row.remarks = `Rejected in ${rounds[i] || 'round'}`;
      }
    } else {
      row[field] = null;
    }
  }

  if (slot.finalSelect) {
    uniqueFields.forEach((f) => {
      row[f] = true;
    });
    row.final_select_status = true;
    row.remarks = row.malpractice ? row.remarks : 'Final selection — offer eligible';
    row.attendance = 'present';
  }

  return row;
}

async function resolveAcademicsTable(client) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'student_semester_records'
     ) AS has_records`
  );
  return rows[0]?.has_records ? 'student_semester_records' : 'student_semester_academics';
}

async function loadStudentPool(client, academicsTable) {
  const useRecords = academicsTable === 'student_semester_records';
  const latestSgpaExpr = useRecords ? 'COALESCE(cgpa, sgpa)' : 'result_in_sgpa';
  const liveBacklogsExpr = useRecords ? 'COALESCE(active_backlogs, 0)' : 'COALESCE(live_backlogs, 0)';

  const { rows } = await client.query(
    `SELECT s.usn, s.school_id, s.program_id, s.current_year,
            prg.name AS program_name, prg.max_duration_years,
            ac.latest_sgpa, ac.live_backlogs
     FROM student_basic_details s
     INNER JOIN user_login ul ON ul.usn = s.usn AND ul.is_active = true
     LEFT JOIN student_edit_control sec ON sec.usn = s.usn
     LEFT JOIN programs prg ON prg.id = s.program_id
     LEFT JOIN LATERAL (
       SELECT (${latestSgpaExpr})::float AS latest_sgpa,
              (${liveBacklogsExpr})::int AS live_backlogs
       FROM public.${academicsTable} r WHERE r.usn = s.usn
       ORDER BY r.academic_year DESC NULLS LAST, r.semester DESC NULLS LAST
       LIMIT 1
     ) ac ON true
     WHERE s.opt_in = true
       AND COALESCE(sec.is_placements_locked, false) = false
       AND COALESCE(s.is_placement_eligible, true) = true
     ORDER BY s.usn`
  );
  return rows;
}

async function bulkUpsertProcess(client, rows) {
  if (!rows.length) return 0;
  let n = 0;
  for (const batch of chunk(rows, 300)) {
    const cols = [
      'placement_drive_id', 'usn', 'is_eligible', 'registration_status', 'approved_status',
      'oa_status', 'gd_status', 'technical_round_status', 'interview_status', 'hr_round_status',
      'final_select_status', 'malpractice', 'remarks', 'attendance',
    ];
    const values = [];
    const params = [];
    let idx = 1;
    batch.forEach((r) => {
      values.push(
        `($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6},$${idx + 7},$${idx + 8},$${idx + 9},$${idx + 10},$${idx + 11},$${idx + 12},$${idx + 13})`
      );
      params.push(
        r.placement_drive_id, r.usn, r.is_eligible, r.registration_status, r.approved_status,
        r.oa_status, r.gd_status, r.technical_round_status, r.interview_status, r.hr_round_status,
        r.final_select_status, r.malpractice, r.remarks, r.attendance
      );
      idx += 14;
    });
    const res = await client.query(
      `INSERT INTO student_placement_process (${cols.join(', ')}) VALUES ${values.join(', ')}`,
      params
    );
    n += res.rowCount || batch.length;
  }
  return n;
}

async function ensureOffer(client, { usn, drive, companyName, rng }) {
  const existing = await client.query(
    `SELECT o.id FROM offers o
     WHERE o.student_id = $1 AND o.company_id = $2
       AND o.remarks ILIKE '%(repair-completed)%'`,
    [usn, drive.company_id]
  );
  if (existing.rows.length) return 0;

  const jt = (drive.job_type || '').toLowerCase();
  const isIntern = jt.includes('intern') && !jt.includes('+');
  const academicYear = drive.academic_year || '2025-26';
  let placementId = null;
  let capstoneId = null;
  let jobType = 'full time';

  if (isIntern) {
    const cap = await client.query(
      `INSERT INTO capstone (usn, company_name, internship_duration_months, designation,
         offer_letter_status, internship_stipend_min, internship_stipend_max, academic_year, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [usn, companyName, 3, 'Engineering Intern', 'Accepted', 25000, 45000, academicYear, '(repair-completed)']
    );
    capstoneId = cap.rows[0].id;
    jobType = 'internship';
  } else {
    const ctc = drive.ctc_structure || {};
    const cmin = Number(ctc.min_lpa) || 12;
    const cmax = Number(ctc.max_lpa) || cmin + 6;
    const pl = await client.query(
      `INSERT INTO placement (student_id, company_id, designation, offer_letter_status,
         ctc_min_lpa, ctc_max_lpa, type_of_hiring, academic_year, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        usn, drive.company_id, 'Software Engineer', 'Accepted',
        cmin, cmax, jt.includes('+') ? 'Internship + Full Time' : 'Full Time',
        academicYear, '(repair-completed)',
      ]
    );
    placementId = pl.rows[0].id;
    jobType = jt.includes('+') ? 'Internship + Full Time' : 'full time';
  }

  await client.query(
    `INSERT INTO offers (student_id, company_id, placement_id, capstone_id, job_type, academic_year, remarks, is_accepted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [usn, drive.company_id, placementId, capstoneId, jobType, academicYear, '(repair-completed)', true]
  );
  return 1;
}

async function main() {
  const rng = createRng(REPAIR_SEED);
  const log = {
    drivesFixed: 0,
    studentsAdded: 0,
    processRows: 0,
    selected: 0,
    offersCreated: 0,
    violationsInserted: 0,
    perDrive: [],
  };

  console.log(`=== Repair completed placement drives ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const academicsTable = await resolveAcademicsTable(client);
    const studentPool = await loadStudentPool(client, academicsTable);
    console.log(`Student pool (opt-in, active, eligible): ${studentPool.length}`);

    const { rows: drives } = await client.query(
      `SELECT pd.*, c.company_name
       FROM placements_drives pd
       LEFT JOIN companies c ON c.id = pd.company_id
       WHERE LOWER(TRIM(COALESCE(pd.placement_status, ''))) IN ('completed', 'closed')
       ORDER BY pd.id`
    );

    console.log(`Completed/closed drives to repair: ${drives.length}\n`);

    const usedUsnsPerDrive = new Map();

    for (const drive of drives) {
      const driveId = Number(drive.id);
      const rounds = normalizeProcessRounds(drive.process_rounds, rng);
      const fieldRounds = mapRoundsToFields(rounds);
      const uniqueRoundFields = [...new Set(fieldRounds.map((x) => x.field))];

      const audit = await client.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE LOWER(registration_status)='registered')::int AS reg,
                COUNT(*) FILTER (WHERE approved_status='Qualified')::int AS qual,
                COUNT(*) FILTER (WHERE final_select_status=true)::int AS sel
         FROM student_placement_process WHERE placement_drive_id=$1`,
        [driveId]
      );
      const before = audit.rows[0];

      const targetN = Math.min(100, Math.max(50, 50 + Math.floor(rng() * 41)));
      const { nApproved, tierCounts, nFinal } = computeFunnelCounts(targetN, uniqueRoundFields.length, rng);

      const scored = studentPool
        .map((s) => ({
          ...s,
          jdScore: jdRelevanceScore(s, drive.job_description, drive.job_type),
        }))
        .sort((a, b) => b.jdScore - a.jdScore);

      const picked = [];
      const used = new Set();
      for (const s of scored) {
        if (picked.length >= targetN) break;
        if (used.has(s.usn)) continue;
        picked.push(s);
        used.add(s.usn);
      }
      for (const s of studentPool) {
        if (picked.length >= targetN) break;
        if (used.has(s.usn)) continue;
        picked.push({ ...s, jdScore: 0 });
        used.add(s.usn);
      }

      const stages = uniqueRoundFields.length;
      const slots = [];
      for (let i = 0; i < picked.length; i++) {
        if (i >= nApproved) {
          slots.push({ inFunnel: false, roundsPassed: 0, failed: false, malpractice: false, finalSelect: false });
          continue;
        }
        if (i < nFinal) {
          slots.push({
            inFunnel: true,
            roundsPassed: stages,
            failed: false,
            malpractice: false,
            finalSelect: true,
          });
          continue;
        }
        let roundsPassed = 0;
        for (let s = stages; s >= 1; s--) {
          if (i < (tierCounts[s] ?? 0)) {
            roundsPassed = s;
            break;
          }
        }
        const clearedAll = roundsPassed >= stages;
        slots.push({
          inFunnel: true,
          roundsPassed: clearedAll ? stages : roundsPassed,
          failed: !clearedAll,
          malpractice: !clearedAll && chance(rng, 0.06),
          finalSelect: false,
        });
      }

      const processRows = picked.map((s, i) => buildProcessRow(s.usn, driveId, rounds, slots[i], rng));
      const violRows = [];
      processRows.forEach((row, i) => {
        if (slots[i].malpractice) {
          violRows.push({
            usn: row.usn,
            placement_drive_id: driveId,
            violation_type: 'MALPRACTICE',
            penalty_type: pick(rng, ['WARNING', 'TEMP_BAN']),
            penalty_days: chance(rng, 0.5) ? 30 : null,
            remarks: '(repair-completed) Malpractice in drive process',
          });
        }
      });

      const selectedUsns = processRows.filter((r) => r.final_select_status).map((r) => r.usn);

      if (!DRY_RUN) {
        await client.query(`DELETE FROM student_placement_process WHERE placement_drive_id = $1`, [driveId]);
        log.processRows += await bulkUpsertProcess(client, processRows);

        await client.query(
          `UPDATE placements_drives SET
             process_rounds = $2::text[],
             placement_status = 'Completed',
             number_of_registrations = $3,
             updated_at = NOW()
           WHERE id = $1`,
          [driveId, rounds, picked.length]
        );

        for (const v of violRows) {
          const exists = await client.query(
            `SELECT 1 FROM student_placement_violations
             WHERE usn=$1 AND placement_drive_id=$2 AND is_active=true LIMIT 1`,
            [v.usn, v.placement_drive_id]
          );
          if (exists.rows.length) continue;
          await client.query(
            `INSERT INTO student_placement_violations (usn, placement_drive_id, violation_type, penalty_type, penalty_days, is_active, remarks)
             VALUES ($1,$2,$3,$4,$5,true,$6)`,
            [v.usn, v.placement_drive_id, v.violation_type, v.penalty_type, v.penalty_days, v.remarks]
          );
          log.violationsInserted += 1;
        }

        for (const usn of selectedUsns) {
          log.offersCreated += await ensureOffer(client, {
            usn,
            drive,
            companyName: drive.company_name,
            rng,
          });
        }
      }

      const uiOa = processRows.filter(
        (r) => String(r.registration_status).toLowerCase() === 'registered' && r.approved_status === 'Qualified'
      ).length;

      log.drivesFixed += 1;
      log.studentsAdded += picked.length;
      log.selected += selectedUsns.length;

      const entry = {
        driveId,
        company: drive.company_name,
        rounds: rounds.join(' → '),
        before,
        after: {
          total: picked.length,
          registered: picked.length,
          qualified: uiOa,
          selected: selectedUsns.length,
          oaTabVisible: uiOa,
        },
      };
      log.perDrive.push(entry);

      console.log(
        `Drive ${driveId} (${drive.company_name}): ${before.total}→${picked.length} students | ` +
          `Qualified=${uiOa} | Selected=${selectedUsns.length} | OA-tab=${uiOa} | rounds=[${rounds.join(', ')}]`
      );
    }

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\n[DRY RUN] No changes committed.');
    } else {
      await client.query('COMMIT');
    }

    console.log('\n========== REPAIR SUMMARY ==========');
    console.log(`Completed drives fixed:  ${log.drivesFixed}`);
    console.log(`Students enrolled:       ${log.studentsAdded}`);
    console.log(`Process rows written:    ${log.processRows}`);
    console.log(`Final selected:          ${log.selected}`);
    console.log(`Offers created (new):    ${log.offersCreated}`);
    console.log(`Violations inserted:     ${log.violationsInserted}`);
    console.log('====================================\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Repair failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
