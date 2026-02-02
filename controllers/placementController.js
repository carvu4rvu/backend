const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

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

/** Get latest academic metrics per student from student_semester_academics. */
async function getStudentAcademicsMap(usns) {
  if (!usns || usns.length === 0) return new Map();
  const { data: academics, error } = await supabase
    .from('student_semester_academics')
    .select('usn, academic_year, semester, result_in_sgpa, live_backlogs, closed_backlogs')
    .in('usn', usns)
    .order('academic_year', { ascending: false })
    .order('semester', { ascending: false });
  if (error || !academics) return new Map();
  const map = new Map();
  const seen = new Set();
  const totalByUsn = {};
  for (const row of academics) {
    if (!row.usn) continue;
    if (!seen.has(row.usn)) {
      seen.add(row.usn);
      map.set(row.usn, {
        latest_sgpa: row.result_in_sgpa != null ? parseFloat(row.result_in_sgpa) : null,
        live_backlogs: row.live_backlogs != null ? parseInt(row.live_backlogs, 10) : 0,
        closed_backlogs: row.closed_backlogs != null ? parseInt(row.closed_backlogs, 10) : 0,
        latest_academic_year: row.academic_year,
      });
    }
    totalByUsn[row.usn] = (totalByUsn[row.usn] || 0) + (row.closed_backlogs != null ? parseInt(row.closed_backlogs, 10) : 0);
  }
  for (const [usn, m] of map) {
    m.total_backlog_history = totalByUsn[usn] || 0;
  }
  return map;
}

/** Evaluate student against placement_drive_eligibility rules. */
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

    // Server-side: verify student is opted in to placement (never trust client/cache)
    const { data: studentRow, error: studentErr } = await supabase
      .from('student_basic_details')
      .select(`
        opt_in, school_id, program_id, major_id, specialization_id,
        year_of_joining, current_year, current_semester,
        schools ( id ),
        programs ( id, max_duration_years )
      `)
      .eq('usn', usn)
      .maybeSingle();
    if (studentErr || !studentRow) return res.status(403).json({ message: 'Student record not found' });
    if (studentRow.opt_in !== true) return res.status(403).json({ message: 'You must opt in to placement from your Personal profile before applying to drives' });

    const { data: existing } = await supabase
      .from('student_placement_process')
      .select('*')
      .eq('usn', usn)
      .eq('placement_drive_id', driveIdNum)
      .maybeSingle();

    const isSelfRegistration = req.user?.usn && String(req.user.usn).toLowerCase() === String(usn).toLowerCase();

    if (existing) {
      if (isSelfRegistration) {
        const currentStatus = String(existing.registration_status || '').toUpperCase();
        if (currentStatus !== 'REGISTERED') {
          const { data: updated, error: updateErr } = await supabase
            .from('student_placement_process')
            .update({ registration_status: 'REGISTERED' })
            .eq('id', existing.id)
            .select()
            .single();
          if (updateErr) {
            logger.error('Apply to drive (update status):', apiMessage(updateErr, 'Update failed'));
            return res.status(400).json({ message: apiMessage(updateErr, 'Update failed') });
          }
          return res.status(200).json(updated);
        }
        return res.status(200).json(existing);
      }
      return res.status(200).json({ message: 'Already applied', data: existing });
    }

    // Self-registration (student applying) = Registered; admin adding students = Pending
    const registrationStatus = isSelfRegistration ? 'REGISTERED' : 'Pending';

    // Check placement_drive_eligibility when admin adds (or self-registers if we want to enforce for students too)
    const { data: eligibility } = await supabase
      .from('placement_drive_eligibility')
      .select('*')
      .eq('placement_drive_id', driveIdNum)
      .maybeSingle();

    let isEligible = true;
    if (eligibility) {
      const academicsMap = await getStudentAcademicsMap([usn]);
      const ac = academicsMap.get(usn) || {};
      const maxYears = studentRow.programs?.max_duration_years ?? 4;
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
      const isAdmin = role === 'admin' || role === 'superadmin';
      const { isEligible: eligible, rejectionReasons } = evaluateEligibility(studentForEval, eligibility, {
        adminOverride: isAdmin && adminOverride && eligibility.admin_override_allowed === true,
      });
      isEligible = eligible;
      if (!isEligible && !(isAdmin && adminOverride && eligibility.admin_override_allowed)) {
        const msg = rejectionReasons && rejectionReasons.length ? rejectionReasons.join('; ') : 'Does not meet eligibility criteria';
        return res.status(403).json({ message: `Eligibility check failed: ${msg}` });
      }
    }

    const { data: inserted, error } = await supabase
      .from('student_placement_process')
      .insert({
        usn,
        placement_drive_id: driveIdNum,
        is_eligible: isEligible,
        registration_status: registrationStatus
      })
      .select()
      .single();

    if (error) {
      logger.error('Apply to drive:', apiMessage(error, 'Apply failed'));
      return res.status(400).json({ message: apiMessage(error, 'Apply failed') });
    }
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
    const { data: studentRow, error: studentErr } = await supabase
      .from('student_basic_details')
      .select('opt_in')
      .eq('usn', usn)
      .maybeSingle();
    if (studentErr || !studentRow) return res.status(403).json({ message: 'Student record not found' });
    if (studentRow.opt_in !== true) return res.status(403).json({ message: 'You must opt in to placement to view applications' });

    // Fetch applications with drive and company details
    // Assuming tables: placements_drives (id, ...), companies (id, company_name, ...)
    // And FKs: student_placement_process.placement_drive_id -> placements_drives.id
    //          placements_drives.company_id -> companies.id
    
    const { data, error } = await supabase
      .from('student_placement_process')
      .select(`
        *,
        drive:placements_drives (
          *,
          company:companies (*)
        )
      `)
      .eq('usn', usn)
      .order('created_at', { ascending: false });

    if (error) {
        logger.error('Supabase error fetching applications:', apiMessage(error));
        const { data: simpleData, error: simpleError } = await supabase
            .from('student_placement_process')
            .select('*')
            .eq('usn', usn);
        if (simpleError) throw simpleError;
        return res.json(simpleData || []);
    }

    // Map data to match frontend expectations if necessary
    // Frontend expects: app.company.company_name, app.drive.job_type
    // The query structure returns: app.drive.company.company_name
    
    const formattedData = data.map(app => ({
        ...app,
        company: app.drive?.company || {},
        drive: app.drive || {}
    }));

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
    const { data: studentRow, error: studentErr } = await supabase
      .from('student_basic_details')
      .select('opt_in')
      .eq('usn', usn)
      .maybeSingle();
    if (studentErr || !studentRow) return res.status(403).json({ message: 'Student record not found' });
    if (studentRow.opt_in !== true) return res.status(403).json({ message: 'You must opt in to placement to view job offers' });

    const { data: placements, error } = await supabase
      .from('placement')
      .select(`
        id,
        student_id,
        company_id,
        designation,
        offer_letter_status,
        ctc_min_lpa,
        ctc_max_lpa,
        type_of_hiring,
        academic_year,
        remarks,
        company:companies(company_name)
      `)
      .eq('student_id', usn)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching student offers:', error);
      return res.status(500).json({ message: apiMessage(error, 'Server error') });
    }

    const placementIds = (placements || []).map((p) => p.id).filter(Boolean);
    let offerByPlacementId = {};
    if (placementIds.length > 0) {
      const { data: offerRows } = await supabase
        .from('offers')
        .select('id, placement_id, is_accepted, remarks')
        .eq('student_id', usn)
        .in('placement_id', placementIds);
      (offerRows || []).forEach((o) => {
        if (o.placement_id != null) offerByPlacementId[o.placement_id] = o;
      });
    }

    const list = (placements || []).map((p) => {
      const offer = offerByPlacementId[p.id];
      return {
        id: p.id,
        offer_id: offer?.id ?? null,
        student_id: p.student_id,
        usn: p.student_id,
        company_name: p.company?.company_name,
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

    const { data: offerRow, error: offerErr } = await supabase
      .from('offers')
      .select('*, placement:placement(*, company:companies(company_name))')
      .eq('id', offer_id)
      .single();

    if (offerErr || !offerRow) return res.status(404).json({ message: 'Offer not found' });
    if (String(offerRow.student_id) !== String(authUsn)) return res.status(403).json({ message: 'Not your offer' });

    const placementRow = offerRow.placement;
    const companyName = placementRow?.company?.company_name;
    const isAccepted = is_accepted === true || String(is_accepted) === 'true';

    const { error: updateErr } = await supabase
        .from('offers')
        .update({ is_accepted: isAccepted, updated_at: new Date().toISOString() })
        .eq('id', offer_id);

    if (updateErr) throw updateErr;

    if (isAccepted) {
      const { data: capstoneRow, error: capErr } = await supabase
        .from('capstone')
        .insert({
          usn: authUsn,
          company_name: companyName || 'Company',
          designation: placementRow.designation || null,
          offer_letter_status: 'Accepted',
          internship_stipend_min: placementRow.ctc_min_lpa || null,
          internship_stipend_max: placementRow.ctc_max_lpa || null,
          academic_year: placementRow.academic_year || null,
          remarks: placementRow.remarks || null,
        })
        .select('id')
        .single();
      if (!capErr && capstoneRow) {
        await supabase.from('offers').update({ capstone_id: capstoneRow.id, updated_at: new Date().toISOString() }).eq('id', offerRow.id);
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
    const { data, error } = await supabase
      .from('student_placement_process')
      .select(`
        *,
        drive:placements_drives (
          id,
          job_type,
          type_of_hiring,
          event_datetime,
          placement_status,
          process_rounds,
          company:companies (company_name)
        ),
        student:student_basic_details (usn, full_name)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('getAllProcessList:', apiMessage(error));
      const { data: simpleData, error: simpleError } = await supabase
        .from('student_placement_process')
        .select('*')
        .order('created_at', { ascending: false });
      if (simpleError) throw simpleError;
      return res.json(simpleData || []);
    }

    const rows = (data || []).map((row) => ({
      ...row,
      company_name: row.drive?.company?.company_name || '-',
      drive_id: row.drive?.id,
      job_type: row.drive?.job_type,
      event_datetime: row.drive?.event_datetime,
      placement_status: row.drive?.placement_status,
      student_name: row.student?.full_name || '-',
    }));
    res.json(rows);
  } catch (error) {
    logger.error('Error fetching process list:', error);
    res.status(500).json({ message: apiMessage(error, 'Server error') });
  }
};

exports.getAllDrives = async (req, res) => {
  try {
    // For students: verify opt-in on every request (never trust client/cache)
    const role = (req.user?.role || '').toString().toLowerCase();
    if (role === 'student' && req.user?.usn) {
      const { data: studentRow } = await supabase.from('student_basic_details').select('opt_in').eq('usn', req.user.usn).maybeSingle();
      if (!studentRow || studentRow.opt_in !== true) {
        return res.status(403).json({ message: 'You must opt in to placement from your Personal profile to view drives' });
      }
    }

    const { data, error } = await supabase
      .from('placements_drives')
      .select(`
        *,
        company:companies (*)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    const driveIds = (data || []).map((d) => d.id).filter(Boolean);
    let registeredCountByDrive = {};
    if (driveIds.length > 0) {
      const { data: processRows } = await supabase
        .from('student_placement_process')
        .select('placement_drive_id')
        .in('placement_drive_id', driveIds);
      (processRows || []).forEach((row) => {
        const id = row.placement_drive_id;
        registeredCountByDrive[id] = (registeredCountByDrive[id] || 0) + 1;
      });
    }
    // Fetch placement_drive_eligibility for drives (new source of truth)
    let eligibilityByDrive = {};
    if (driveIds.length > 0) {
      const { data: eligibilityRows } = await supabase
        .from('placement_drive_eligibility')
        .select('*')
        .in('placement_drive_id', driveIds);
      (eligibilityRows || []).forEach((e) => { eligibilityByDrive[e.placement_drive_id] = e; });
    }
    const schoolIds = new Set();
    const programIds = new Set();
    (data || []).forEach((d) => {
      const elig = eligibilityByDrive[d.id];
      if (elig && Array.isArray(elig.allowed_school_ids)) elig.allowed_school_ids.forEach((id) => schoolIds.add(id));
      if (elig && Array.isArray(elig.allowed_program_ids)) elig.allowed_program_ids.forEach((id) => programIds.add(id));
      if (!elig && d.eligibility_academics?.school_id) schoolIds.add(d.eligibility_academics.school_id);
      if (!elig && d.eligibility_academics?.program_id) programIds.add(d.eligibility_academics.program_id);
    });
    let schoolMap = {};
    let programMap = {};
    if (schoolIds.size) {
      const { data: schools } = await supabase.from('schools').select('id, name').in('id', [...schoolIds]);
      schoolMap = (schools || []).reduce((acc, s) => { acc[s.id] = s.name; return acc; }, {});
    }
    if (programIds.size) {
      const { data: programs } = await supabase.from('programs').select('id, name').in('id', [...programIds]);
      programMap = (programs || []).reduce((acc, p) => { acc[p.id] = p.name; return acc; }, {});
    }
    const drives = (data || []).map((d) => {
      const elig = eligibilityByDrive[d.id];
      const sid = elig && Array.isArray(elig.allowed_school_ids) && elig.allowed_school_ids.length > 0
        ? elig.allowed_school_ids[0] : d.eligibility_academics?.school_id;
      const pid = elig && Array.isArray(elig.allowed_program_ids) && elig.allowed_program_ids.length > 0
        ? elig.allowed_program_ids[0] : d.eligibility_academics?.program_id;
      return {
        ...d,
        process_rounds: sanitizeProcessRounds(d.process_rounds),
        company_name: d.company?.company_name ?? null,
        placement_drive_eligibility: elig || null,
        school_id: sid ?? null,
        program_id: pid ?? null,
        school: sid ? schoolMap[sid] ?? null : null,
        program: pid ? programMap[pid] ?? null : null,
        registered_count: registeredCountByDrive[d.id] ?? 0,
      };
    });
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
    const midnight = regEnd.getUTCHours() === 0 && regEnd.getUTCMinutes() === 0 && regEnd.getUTCSeconds() === 0;
    if (dateOnly || midnight) regEnd.setUTCHours(23, 59, 59, 999);
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
    const { data: drives, error } = await supabase
      .from('placements_drives')
      .select('id, placement_status, last_date_to_registration, event_datetime');

    if (error) throw error;
    const manualStatuses = ['cancelled', 'postponed'];
    let updated = 0;
    for (const d of drives || []) {
      const current = String(d.placement_status || '').toLowerCase();
      if (manualStatuses.includes(current)) continue;
      const newStatus = derivePlacementStatus(d.last_date_to_registration, d.event_datetime);
      if (newStatus === (d.placement_status || '')) continue;
      const { error: updateErr } = await supabase
        .from('placements_drives')
        .update({ placement_status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', d.id);
      if (!updateErr) updated++;
    }
    res.json({ updated, total: (drives || []).length });
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

    const { data, error } = await supabase
      .from('placements_drives')
      .select(`
        *,
        company:companies (*)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ message: 'Drive not found' });
      throw error;
    }
    const { data: elig } = await supabase
      .from('placement_drive_eligibility')
      .select('*')
      .eq('placement_drive_id', id)
      .maybeSingle();
    const sid = elig?.allowed_school_ids?.[0] ?? data.eligibility_academics?.school_id;
    const pid = elig?.allowed_program_ids?.[0] ?? data.eligibility_academics?.program_id;
    let school = null;
    let program = null;
    if (sid) {
      const { data: s } = await supabase.from('schools').select('name').eq('id', sid).maybeSingle();
      school = s?.name ?? null;
    }
    if (pid) {
      const { data: p } = await supabase.from('programs').select('name').eq('id', pid).maybeSingle();
      program = p?.name ?? null;
    }
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

    // Auto-expire: set Pending -> Not Registered when deadline has passed
    const { data: driveRow } = await supabase
      .from('placements_drives')
      .select('last_date_to_registration')
      .eq('id', driveId)
      .maybeSingle();
    const deadline = driveRow?.last_date_to_registration;
    if (deadline && new Date(deadline) < new Date()) {
      const updatePayload = { registration_status: 'Not Registered', updated_at: new Date().toISOString() };
      await supabase.from('student_placement_process').update(updatePayload).eq('placement_drive_id', driveId).eq('registration_status', 'Pending');
      await supabase.from('student_placement_process').update(updatePayload).eq('placement_drive_id', driveId).is('registration_status', null);
    }

    const { data, error } = await supabase
      .from('student_placement_process')
      .select(`
        *,
        drive:placements_drives ( id, job_type, process_rounds, placement_status ),
        student:student_basic_details ( usn, full_name )
      `)
      .eq('placement_drive_id', driveId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('getDriveRegistrations:', apiMessage(error));
      const { data: simple, error: simpleErr } = await supabase
        .from('student_placement_process')
        .select('*')
        .eq('placement_drive_id', driveId)
        .order('created_at', { ascending: false });
      if (simpleErr) return res.status(400).json({ message: simpleErr.message || 'Failed to fetch registrations' });
      return res.json(simple || []);
    }

    const rows = (data || []).map((row) => ({
      ...row,
      student_name: row.student?.full_name ?? null,
    }));
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

    // Fetch process records
    const { data: processRows, error: procErr } = await supabase
      .from('student_placement_process')
      .select('*')
      .eq('placement_drive_id', driveId)
      .order('created_at', { ascending: false });

    if (procErr) return res.status(400).json({ message: procErr.message || 'Failed to fetch registrations' });

    let processes = processRows || [];
    if (stage === 'approved') {
      processes = processes.filter((p) => String(p.registration_status || '').toLowerCase() === 'registered');
    }

    const usns = [...new Set(processes.map((p) => p.usn).filter(Boolean))];
    if (usns.length === 0) return res.json({ data: [], columns: [] });

    // Fetch student basic details
    const { data: basics } = await supabase
      .from('student_basic_details')
      .select('usn, full_name, college_email, personal_email, phone_country_code, phone_number, year_of_joining, current_year, current_semester, section, gender, school_id, program_id, major_id, specialization_id')
      .in('usn', usns);

    const basicMap = new Map((basics || []).map((b) => [b.usn, b]));

    // Fetch school, program, major, specialization names
    const schoolIds = [...new Set((basics || []).map((b) => b.school_id).filter(Boolean))];
    const programIds = [...new Set((basics || []).map((b) => b.program_id).filter(Boolean))];
    const majorIds = [...new Set((basics || []).map((b) => b.major_id).filter(Boolean))];
    const specIds = [...new Set((basics || []).map((b) => b.specialization_id).filter(Boolean))];

    const [
      { data: schools },
      { data: programs },
      { data: majors },
      { data: specializations },
    ] = await Promise.all([
      schoolIds.length ? supabase.from('schools').select('id, name').in('id', schoolIds) : { data: [] },
      programIds.length ? supabase.from('programs').select('id, name').in('id', programIds) : { data: [] },
      majorIds.length ? supabase.from('majors').select('id, name').in('id', majorIds) : { data: [] },
      specIds.length ? supabase.from('specializations').select('id, name').in('id', specIds) : { data: [] },
    ]);

    const schoolMap = new Map((schools || []).map((s) => [s.id, s.name]));
    const programMap = new Map((programs || []).map((p) => [p.id, p.name]));
    const majorMap = new Map((majors || []).map((m) => [m.id, m.name]));
    const specMap = new Map((specializations || []).map((s) => [s.id, s.name]));

    // Fetch profile (resume, career)
    const { data: profiles } = await supabase
      .from('student_profile_details')
      .select('usn, resume_file, brief_summary, key_expertise, career_objective')
      .in('usn', usns);

    const profileMap = new Map((profiles || []).map((p) => [p.usn, p]));

    // Fetch projects (titles)
    const { data: projects } = await supabase
      .from('student_projects')
      .select('usn, title')
      .in('usn', usns)
      .order('priority', { ascending: true });

    const projectByUsn = {};
    (projects || []).forEach((p) => {
      if (!projectByUsn[p.usn]) projectByUsn[p.usn] = [];
      projectByUsn[p.usn].push(p.title || '');
    });

    // Fetch education (10th, 12th, graduation)
    const { data: education } = await supabase
      .from('student_education_history')
      .select('usn, education_level, institute_name, year_of_passing, result, result_type')
      .in('usn', usns);

    const eduByUsn = {};
    (education || []).forEach((e) => {
      if (!eduByUsn[e.usn]) eduByUsn[e.usn] = [];
      eduByUsn[e.usn].push(`${e.education_level}: ${e.institute_name || ''} (${e.year_of_passing || ''})`);
    });

    // Fetch academics (CGPA, backlogs)
    const { data: academics } = await supabase
      .from('student_semester_academics')
      .select('usn, academic_year, semester, result_in_sgpa, live_backlogs, closed_backlogs')
      .in('usn', usns)
      .order('academic_year', { ascending: false })
      .order('semester', { ascending: false });

    const acadByUsn = {};
    (academics || []).forEach((a) => {
      if (!acadByUsn[a.usn]) {
        acadByUsn[a.usn] = { latest_sgpa: a.result_in_sgpa, live_backlogs: a.live_backlogs || 0, closed_backlogs: a.closed_backlogs || 0 };
      }
    });

    // Fetch internships (for experience)
    const { data: internships } = await supabase
      .from('student_internships')
      .select('usn, job_role, organization, duration_months')
      .in('usn', usns);

    const intByUsn = {};
    (internships || []).forEach((i) => {
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
        program: basic.program_id ? programMap.get(basic.program_id) || null : null,
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
        registration_status: proc.registration_status || null,
        approved_status: proc.approved_status || null,
        is_eligible: proc.is_eligible ?? null,
        oa_status: proc.oa_status ?? null,
        gd_status: proc.gd_status ?? null,
        technical_round_status: proc.technical_round_status ?? null,
        interview_status: proc.interview_status ?? null,
        hr_round_status: proc.hr_round_status ?? null,
        final_select_status: proc.final_select_status ?? null,
        malpractice: proc.malpractice ?? null,
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

    const { data: deleted, error } = await supabase
      .from('student_placement_process')
      .delete()
      .eq('placement_drive_id', driveId)
      .eq('usn', usn)
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('removeFromProcess:', apiMessage(error));
      return res.status(400).json({ message: apiMessage(error, 'Failed to remove from process') });
    }
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
    const payload = { updated_at: new Date().toISOString() };
    allowed.forEach((key) => {
      if (body[key] !== undefined) payload[key] = body[key];
    });

    if (Object.keys(payload).length <= 1) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('student_placement_process')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ message: apiMessage(error, 'Update failed') });
    if (!data) return res.status(404).json({ message: 'Process record not found' });
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

    const { data, error } = await supabase
      .from('placements_drives')
      .insert(row)
      .select()
      .single();

    if (error) {
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
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('placements_drives')
      .update(row)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Update placement drive:', apiMessage(error, 'Failed to update drive'));
      const msg = error.code === 'PGRST116' ? 'Drive not found.' : (error.code === '23503' ? 'Invalid company reference.' : apiMessage(error, 'Failed to update drive'));
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
    const updates = {
      placement_status: newStatus,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('placements_drives')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      logger.error('Patch placement drive:', apiMessage(error, 'Failed to update drive'));
      return res.status(400).json({ message: error.code === 'PGRST116' ? 'Drive not found.' : apiMessage(error, 'Failed to update drive') });
    }
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
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('placements_drives')
      .update({ placement_status, updated_at: now })
      .eq('id', id)
      .select('id, placement_status, updated_at')
      .single();
    if (error) {
      logger.error('Update placement drive status:', apiMessage(error, 'Failed to update'));
      return res.status(400).json({
        message: error.code === 'PGRST116' ? 'Drive not found.' : (error.message || 'Failed to update placement status'),
      });
    }
    if (!data) {
      return res.status(404).json({ message: 'Drive not found' });
    }
    res.json(data);
  } catch (err) {
    logger.error('Update placement drive status:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * GET /placement/drives/:driveId/eligibility
 * Returns placement_drive_eligibility for a drive.
 */
exports.getDriveEligibility = async (req, res) => {
  try {
    const driveId = parseInt(req.params.driveId, 10);
    if (Number.isNaN(driveId)) return res.status(400).json({ message: 'Invalid drive ID' });

    const { data, error } = await supabase
      .from('placement_drive_eligibility')
      .select('*')
      .eq('placement_drive_id', driveId)
      .maybeSingle();

    if (error) throw error;
    res.json(data || null);
  } catch (err) {
    logger.error('getDriveEligibility:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * PUT /placement/drives/:driveId/eligibility
 * Upsert placement_drive_eligibility for a drive.
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

    const payload = {
      placement_drive_id: driveId,
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
      no_disciplinary_action: body.no_disciplinary_action !== false,
      no_active_placement_violation: body.no_active_placement_violation !== false,
      admin_override_allowed: body.admin_override_allowed === true,
      max_total_offers: body.max_total_offers != null && body.max_total_offers !== '' ? parseInt(body.max_total_offers, 10) : null,
    };
    Object.keys(payload).forEach((k) => { if (payload[k] === undefined) delete payload[k]; });

    const { data: existing } = await supabase
      .from('placement_drive_eligibility')
      .select('id')
      .eq('placement_drive_id', driveId)
      .maybeSingle();

    delete payload.placement_drive_id;
    let result;
    if (existing) {
      const { data: updated, error: updErr } = await supabase
        .from('placement_drive_eligibility')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (updErr) throw updErr;
      result = updated;
    } else {
      payload.placement_drive_id = driveId;
      const { data: inserted, error: insErr } = await supabase
        .from('placement_drive_eligibility')
        .insert(payload)
        .select()
        .single();
      if (insErr) throw insErr;
      result = inserted;
    }

    // Add all eligible students to this drive's process and auto-send notification
    try {
      const schoolIds = result.allowed_school_ids && result.allowed_school_ids.length ? result.allowed_school_ids : null;
      const programIds = result.allowed_program_ids && result.allowed_program_ids.length ? result.allowed_program_ids : null;

      let eligibleQuery = supabase
        .from('student_basic_details')
        .select('usn')
        .eq('is_active', true)
        .eq('opt_in', true)
        .order('usn', { ascending: true })
        .limit(10000);
      if (schoolIds && schoolIds.length) eligibleQuery = eligibleQuery.in('school_id', schoolIds);
      if (programIds && programIds.length) eligibleQuery = eligibleQuery.in('program_id', programIds);
      const { data: eligibleRows, error: eligibleErr } = await eligibleQuery;
      if (eligibleErr) throw eligibleErr;
      const eligibleUsns = (eligibleRows || []).map((r) => r.usn).filter(Boolean);
      if (eligibleUsns.length === 0) {
        return res.json({ ...result, addedToProcess: 0, notified: 0 });
      }

      const { data: existingProcess } = await supabase
        .from('student_placement_process')
        .select('usn')
        .eq('placement_drive_id', driveId);
      const existingSet = new Set((existingProcess || []).map((r) => r.usn));
      const toAdd = eligibleUsns.filter((u) => !existingSet.has(u));
      const processRows = toAdd.map((usn) => ({
        usn,
        placement_drive_id: driveId,
        is_eligible: true,
        registration_status: 'Pending',
      }));

      if (processRows.length > 0) {
        const BATCH = 200;
        for (let i = 0; i < processRows.length; i += BATCH) {
          const chunk = processRows.slice(i, i + BATCH);
          const { error: procErr } = await supabase.from('student_placement_process').insert(chunk);
          if (procErr) logger.warn('Eligibility: add to process batch error', procErr.message);
        }
      }

      const { data: driveRow, error: driveErr } = await supabase
        .from('placements_drives')
        .select('id, job_type, job_location, type_of_hiring, event_datetime, last_date_to_registration, job_description, company:companies(company_name)')
        .eq('id', driveId)
        .single();
      if (driveErr || !driveRow) {
        logger.warn('Eligibility: drive fetch failed for notification', driveErr?.message);
        return res.json({ ...result, addedToProcess: processRows.length, notified: 0 });
      }

      const companyName = driveRow.company?.company_name || 'Company';
      const eventDate = driveRow.event_datetime ? new Date(driveRow.event_datetime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
      const regDate = driveRow.last_date_to_registration ? new Date(driveRow.last_date_to_registration).toLocaleDateString() : '—';
      const title = `Placement drive: ${companyName}`;
      const message = [
        `${companyName} – ${driveRow.job_type || '—'}`,
        driveRow.job_location ? `Location: ${driveRow.job_location}` : null,
        driveRow.type_of_hiring ? `Hiring: ${driveRow.type_of_hiring}` : null,
        `Event date: ${eventDate}`,
        `Last date to register: ${regDate}`,
        driveRow.job_description ? driveRow.job_description.slice(0, 200) + (driveRow.job_description.length > 200 ? '…' : '') : '',
      ].filter(Boolean).join('\n');
      const link = `/placement/events/${driveId}`;
      const createdBy = req.user?.id != null ? String(req.user.id) : null;

      const { data: notification, error: notifErr } = await supabase
        .from('notifications')
        .insert({
          title,
          message,
          type: 'PLACEMENT',
          link,
          drive_id: driveId,
          created_by: createdBy,
        })
        .select()
        .single();
      if (notifErr || !notification) {
        logger.warn('Eligibility: create notification failed', notifErr?.message);
        return res.json({ ...result, addedToProcess: processRows.length, notified: 0 });
      }

      const snRows = eligibleUsns.map((usn) => ({
        usn,
        notification_id: notification.id,
        is_read: false,
      }));
      const SN_BATCH = 200;
      for (let i = 0; i < snRows.length; i += SN_BATCH) {
        const chunk = snRows.slice(i, i + SN_BATCH);
        const { error: snErr } = await supabase.from('student_notifications').insert(chunk);
        if (snErr) logger.warn('Eligibility: send notification batch error', snErr.message);
      }

      return res.json({
        ...result,
        addedToProcess: processRows.length,
        notified: eligibleUsns.length,
      });
    } catch (postErr) {
      logger.warn('Eligibility: add students / notify failed', postErr?.message);
      res.json(result);
    }
  } catch (err) {
    logger.error('upsertDriveEligibility:', err);
    res.status(500).json({ message: apiMessage(err, 'Server error') });
  }
};

/**
 * GET /placement/students
 * Returns list of students for "Add Students to Drive" (admin).
 * Query: school_id, school_ids, program_id, program_ids, search, limit, opt_in_only, drive_id (optional - includes academics and eligibility).
 */
exports.getStudentsForPlacement = async (req, res) => {
  try {
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 2000));
    const search = (req.query.search || '').trim();
    const schoolId = req.query.school_id ? parseInt(req.query.school_id, 10) : null;
    const programId = req.query.program_id ? parseInt(req.query.program_id, 10) : null;
    const schoolIds = req.query.school_ids ? req.query.school_ids.split(',').map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n)) : null;
    const programIds = req.query.program_ids ? req.query.program_ids.split(',').map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n)) : null;
    const optedInOnly = req.query.opt_in_only === '1' || req.query.opt_in_only === 'true';
    const driveId = req.query.drive_id ? parseInt(req.query.drive_id, 10) : null;
    const includeAcademics = driveId != null && !Number.isNaN(driveId);

    let query = supabase
      .from('student_basic_details')
      .select(`
        usn, full_name, college_email, personal_email, school_id, program_id, major_id, specialization_id,
        year_of_joining, current_year, current_semester, section, is_active,
        schools ( id, name, abbreviation ),
        programs ( id, name, min_duration_years, max_duration_years ),
        majors ( id, name ),
        specializations ( id, name )
      `)
      .eq('is_active', true)
      .order('usn', { ascending: true })
      .limit(limit);

    if (optedInOnly) query = query.eq('opt_in', true);
    if (schoolIds && schoolIds.length > 0) query = query.in('school_id', schoolIds);
    else if (schoolId != null && !Number.isNaN(schoolId)) query = query.eq('school_id', schoolId);
    if (programIds && programIds.length > 0) query = query.in('program_id', programIds);
    else if (programId != null && !Number.isNaN(programId)) query = query.eq('program_id', programId);
    if (search) {
      query = query.or(`usn.ilike.%${search}%,full_name.ilike.%${search}%,college_email.ilike.%${search}%,personal_email.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    let list = (data || []).map((s) => {
      const maxYears = s.programs?.max_duration_years ?? 4;
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
        school: s.schools?.name ?? null,
        program: s.programs?.name ?? null,
        major: s.majors?.name ?? null,
        specialization: s.specializations?.name ?? null,
        year_of_joining: s.year_of_joining,
        graduation_year: gradYear,
        current_year: s.current_year,
        current_semester: s.current_semester,
        section: s.section,
        is_active: s.is_active,
      };
    });

    if (includeAcademics && list.length > 0) {
      const usns = list.map((s) => s.usn).filter(Boolean);
      const academicsMap = await getStudentAcademicsMap(usns);
      list = list.map((s) => {
        const ac = academicsMap.get(s.usn) || {};
        return {
          ...s,
          latest_sgpa: ac.latest_sgpa ?? null,
          live_backlogs: ac.live_backlogs ?? 0,
          closed_backlogs: ac.closed_backlogs ?? 0,
          total_backlog_history: ac.total_backlog_history ?? 0,
          latest_academic_year: ac.latest_academic_year ?? null,
        };
      });

      if (driveId) {
        const { data: elig } = await supabase
          .from('placement_drive_eligibility')
          .select('*')
          .eq('placement_drive_id', driveId)
          .maybeSingle();
        if (elig) {
          list = list.map((s) => {
            const { isEligible, rejectionReasons } = evaluateEligibility(s, elig);
            return { ...s, is_eligible: isEligible, rejection_reasons: rejectionReasons };
          });
        }
      }
    }

    res.json(list);
  } catch (err) {
    logger.error('getStudentsForPlacement:', err);
    res.status(500).json({ message: 'Server error fetching students' });
  }
};

exports.getAllCompanies = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('company_name', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    logger.error('Error fetching companies:', error);
    res.json([]);
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

    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ message: 'Company not found' });
      throw error;
    }
    res.json(data);
  } catch (error) {
    console.error('Error fetching company:', error);
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

    const { data, error } = await supabase
      .from('placements_drives')
      .select('*')
      .eq('company_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    const drives = (data || []).map((d) => {
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

    const { data: placements, error: plErr } = await supabase
      .from('placement')
      .select(`
        id,
        student_id,
        designation,
        offer_letter_status,
        ctc_min_lpa,
        ctc_max_lpa,
        type_of_hiring,
        academic_year,
        student_basic_details!inner(full_name, schools(name))
      `)
      .eq('company_id', id)
      .order('created_at', { ascending: false });

    if (plErr) {
      const { data: simple, error: simpleErr } = await supabase
        .from('placement')
        .select('id, student_id, designation, offer_letter_status, ctc_min_lpa, ctc_max_lpa, type_of_hiring, academic_year')
        .eq('company_id', id)
        .order('created_at', { ascending: false });
      if (simpleErr) throw simpleErr;
      const offers = (simple || []).map((p) => ({
        id: p.id,
        usn: p.student_id,
        student_name: null,
        school: '-',
        ctc: [p.ctc_min_lpa, p.ctc_max_lpa].filter((x) => x != null).join('–') || '-',
        job_type: p.type_of_hiring || '-',
        designation: p.designation || '-',
        offer_letter_status: p.offer_letter_status || '-',
      }));
      return res.json(offers);
    }

    const offers = (placements || []).map((p) => {
      const ctc = [p.ctc_min_lpa, p.ctc_max_lpa].filter((x) => x != null);
      const ctcStr = ctc.length ? ctc.join('–') : '-';
      const student = p.student_basic_details || {};
      const school = student.schools?.name || '-';
      return {
        id: p.id,
        usn: p.student_id,
        student_name: student.full_name || null,
        school,
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
      company_type: body.company_type || null,
      address: body.address || null,
      website: body.website || null,
      linkedin: body.linkedin || null,
      remarks: remarks.length ? remarks : null,
      company_logo_link: body.company_logo_link || body.logo || null,
    };

    const { data, error } = await supabase
      .from('companies')
      .insert(payload)
      .select()
      .single();

    if (error) {
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
        await supabase.from('contacts').insert(contactRows);
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
    if (body.address != null) payload.address = body.address;
    if (body.website != null) payload.website = body.website;
    if (body.linkedin != null) payload.linkedin = body.linkedin;
    if (remarks != null) payload.remarks = remarks.length ? remarks : null;
    if (body.company_logo_link != null) payload.company_logo_link = body.company_logo_link;
    if (body.logo != null) payload.company_logo_link = body.logo;

    const { data, error } = await supabase
      .from('companies')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
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
 * GET /placement/companies/:id/contacts
 * List contacts for a company.
 */
exports.getCompanyContacts = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid company id' });

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('company_id', id)
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(data || []);
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

    const { data, error } = await supabase
      .from('contacts')
      .insert(contactRows)
      .select();

    if (error) throw error;
    res.status(201).json(Array.isArray(data) ? data : [data]);
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

    const { data, error } = await supabase
      .from('contacts')
      .update(payload)
      .eq('id', contactId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;
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

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', contactId)
      .eq('company_id', companyId);

    if (error) throw error;
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
    let snapshotQuery = supabase.from('placement_academic_year_snapshot').select('*');
    if (academicYear) snapshotQuery = snapshotQuery.eq('academic_year', academicYear);
    const [
      { data: students },
      { data: schools },
      { data: programs },
      { data: policies },
      { data: snapshotRows },
      { data: placementRows }
    ] = await Promise.all([
      supabase.from('student_basic_details').select('usn, school_id, program_id, year_of_joining, current_year').eq('is_active', true),
      supabase.from('schools').select('id, name'),
      supabase.from('programs').select('id, school_id, name, graduation_level'),
      supabase.from('batch_academic_policies').select('school_id, program_id, joining_year, summer_immersion, summer_internship, capstone, placement'),
      snapshotQuery,
      supabase.from('placement').select('student_id, ctc_min_lpa, ctc_max_lpa, academic_year')
    ]);

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

    const key = (schoolId, programId, year) => `${schoolId}-${programId}-${year}`;
    const agg = {};
    (students || []).forEach((s) => {
      const k = key(s.school_id, s.program_id, s.current_year);
      if (!agg[k]) {
        const schoolName = schoolMap[s.school_id] || 'Unknown';
        const prog = programMap[s.program_id];
        agg[k] = {
          school: schoolName,
          course: prog ? prog.name : 'Unknown',
          currentYear: s.current_year,
          currentYearLabel: yearLabels[s.current_year] || `${s.current_year}`,
          batchStrength: 0,
          mode: getMode(prog && prog.graduation_level, s.current_year, s.year_of_joining, s.school_id, s.program_id),
          studentsTrained: 0,
          optedIn: 0,
          currentPlacement: 0,
          graduationLevel: prog && prog.graduation_level
        };
      }
      agg[k].batchStrength += 1;
    });

    const placementByStudent = (placementRows || []).reduce((acc, p) => {
      acc[p.student_id] = (acc[p.student_id] || []).concat(p);
      return acc;
    }, {});

    const schoolOverview = {};
    (students || []).forEach((s) => {
      const schoolName = schoolMap[s.school_id] || 'Unknown';
      if (!schoolOverview[schoolName]) schoolOverview[schoolName] = { max: 0, min: 0, avg: 0, median: 0, paidInternships: 0 };
      const placements = placementByStudent[s.usn] || [];
      placements.forEach((pl) => {
        const ctc = pl.ctc_max_lpa != null ? pl.ctc_max_lpa : pl.ctc_min_lpa;
        if (ctc != null) {
          if (schoolOverview[schoolName].max < ctc) schoolOverview[schoolName].max = ctc;
          if (schoolOverview[schoolName].min === 0 || schoolOverview[schoolName].min > ctc) schoolOverview[schoolName].min = ctc;
        }
      });
    });
    Object.keys(schoolOverview).forEach((name) => {
      const snap = (snapshotRows || []).find((r) => r.school_name === name);
      if (snap) {
        schoolOverview[name].max = snap.max_ctc != null ? Number(snap.max_ctc) : schoolOverview[name].max;
        schoolOverview[name].min = snap.min_ctc != null ? Number(snap.min_ctc) : schoolOverview[name].min;
        schoolOverview[name].avg = snap.avg_ctc != null ? Number(snap.avg_ctc) : 0;
        schoolOverview[name].median = snap.median_ctc != null ? Number(snap.median_ctc) : 0;
        schoolOverview[name].paidInternships = snap.paid_internships_count != null ? snap.paid_internships_count : 0;
      }
    });

    const rows = Object.values(agg).sort((a, b) => {
      const sc = (a.school || '').localeCompare(b.school || '');
      if (sc !== 0) return sc;
      const cc = (a.course || '').localeCompare(b.course || '');
      if (cc !== 0) return cc;
      return (a.currentYear || 0) - (b.currentYear || 0);
    });

    const academicYears = [...new Set((snapshotRows || []).map((r) => r.academic_year).filter(Boolean))].sort().reverse();
    if (academicYears.length === 0) {
      const years = [...new Set((students || []).map((s) => s.year_of_joining).filter(Boolean))].sort().reverse();
      academicYears.push(...years.map((y) => String(y)));
    }

    res.json({ rows, schoolOverview, academicYears });
  } catch (err) {
    logger.error('getPlacementOverview:', err);
    res.status(500).json({ message: 'Server error fetching placement overview' });
  }
};

/**
 * GET /placement/policies - list batch_academic_policies with school/program names
 */
exports.getAllPolicies = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('batch_academic_policies')
      .select(`
        *,
        schools ( name ),
        programs ( name )
      `)
      .order('joining_year', { ascending: false });

    if (error) throw error;
    const list = (data || []).map((p) => ({
      ...p,
      school_name: p.schools?.name || null,
      program_name: p.programs?.name || null
    }));
    res.json(list);
  } catch (err) {
    logger.error('getAllPolicies:', err);
    res.status(500).json({ message: 'Server error fetching policies' });
  }
};

/**
 * POST /placement/policies - upsert one batch_academic_policy
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
    if (id && !Number.isNaN(id)) {
      const { data, error } = await supabase.from('batch_academic_policies').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return res.json(data);
    }
    const { data, error } = await supabase.from('batch_academic_policies').insert(payload).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    logger.error('upsertPolicy:', err);
    res.status(500).json({ message: err.message || 'Failed to upsert policy' });
  }
};

/**
 * GET /placement/policies/me - get batch academic policy for the logged-in student (by usn -> school_id, program_id, year_of_joining)
 */
exports.getMyPolicy = async (req, res) => {
  try {
    const usn = req.user?.usn;
    if (!usn) return res.status(403).json({ message: 'Student USN required' });

    const { data: student, error: studentError } = await supabase
      .from('student_basic_details')
      .select('school_id, program_id, year_of_joining, opt_in')
      .eq('usn', usn)
      .maybeSingle();

    if (studentError || !student?.school_id || !student?.program_id || student?.year_of_joining == null) {
      return res.json({
        summer_immersion: false,
        summer_internship: false,
        capstone: false,
        placement: false,
        opt_in: !!student?.opt_in
      });
    }

    const { data: policy, error } = await supabase
      .from('batch_academic_policies')
      .select('summer_immersion, summer_internship, capstone, placement')
      .eq('school_id', student.school_id)
      .eq('program_id', student.program_id)
      .eq('joining_year', student.year_of_joining)
      .maybeSingle();

    if (error || !policy) {
      return res.json({
        summer_immersion: false,
        summer_internship: false,
        capstone: false,
        placement: false,
        opt_in: !!student.opt_in
      });
    }

    res.json({
      summer_immersion: !!policy.summer_immersion,
      summer_internship: !!policy.summer_internship,
      capstone: !!policy.capstone,
      placement: !!policy.placement,
      opt_in: !!student.opt_in
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
    const { data: students } = await supabase.from('student_basic_details').select('school_id, program_id, year_of_joining');
    const keys = new Set();
    (students || []).forEach((s) => {
      if (s.school_id && s.program_id && s.year_of_joining) keys.add(`${s.school_id}-${s.program_id}-${s.year_of_joining}`);
    });
    const { data: existing } = await supabase.from('batch_academic_policies').select('id, school_id, program_id, joining_year');
    const existingKeys = new Set((existing || []).map((p) => `${p.school_id}-${p.program_id}-${p.joining_year}`));
    const toInsert = [];
    keys.forEach((k) => {
      if (existingKeys.has(k)) return;
      const [school_id, program_id, joining_year] = k.split('-').map(Number);
      toInsert.push({ school_id, program_id, joining_year, summer_immersion: false, summer_internship: false, capstone: false, placement: false, alumni: false });
    });
    if (toInsert.length > 0) {
      const { error } = await supabase.from('batch_academic_policies').insert(toInsert);
      if (error) throw error;
    }
    res.json({ message: `Synced; ${toInsert.length} new policies added.` });
  } catch (err) {
    logger.error('syncPolicies:', err);
    res.status(500).json({ message: err.message || 'Sync failed' });
  }
};

// --- Alumni ---

/**
 * GET /placement/alumni - list all alumni
 */
exports.getAllAlumni = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('alumni')
      .select('*')
      .order('full_name', { ascending: true });

    if (error) throw error;
    const list = (data || []).map((a) => ({
      ...a,
      usn: a.student_id
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

    const { data, error } = await supabase.from('alumni').insert(payload).select().single();
    if (error) throw error;
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

    let q = supabase.from('alumni').select('*');
    if (byId) q = q.eq('id', idNum);
    else q = q.eq('student_id', identifier);
    const { data, error } = await q.maybeSingle();

    if (error) throw error;
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

    let q = supabase.from('alumni').select('id');
    if (byId) q = q.eq('id', idNum);
    else q = q.eq('student_id', identifier);
    const { data: existing, error: findErr } = await q.maybeSingle();

    if (findErr) throw findErr;
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

    const { data: updated, error } = await supabase
      .from('alumni')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
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
    const { data, error } = await supabase
      .from('alumni')
      .select('*')
      .ilike('personal_email', email)
      .maybeSingle();

    if (error) throw error;
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
    const { data: existing, error: findErr } = await supabase
      .from('alumni')
      .select('id')
      .ilike('personal_email', email)
      .maybeSingle();

    if (findErr) throw findErr;
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
      updated_at: new Date().toISOString()
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const { data: updated, error } = await supabase
      .from('alumni')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
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
    const { data, error } = await supabase
      .from('alumni_registration_codes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
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

    const { data, error } = await supabase.from('alumni_registration_codes').insert(payload).select().single();
    if (error) throw error;
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

    const { data, error } = await supabase
      .from('alumni_registration_codes')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ message: 'Code not found' });
    res.json(data);
  } catch (err) {
    logger.error('deleteRegistrationCode:', err);
    res.status(500).json({ message: err.message || 'Failed to deactivate code' });
  }
};

/**
 * GET /placement/job-offers - get all job offers with student and company details (admin)
 */
exports.getAllJobOffers = async (req, res) => {
  try {
    // First, get all placement records with company info
    const { data: placements, error: placementError } = await supabase
      .from('placement')
      .select(`
        id,
        student_id,
        company_id,
        designation,
        offer_letter_status,
        ctc_min_lpa,
        ctc_max_lpa,
        ctc_variable_pay,
        ctc_stock_in_lpa,
        type_of_hiring,
        academic_year,
        remarks,
        created_at,
        updated_at,
        companies(company_name)
      `)
      .order('created_at', { ascending: false });

    if (placementError) {
      logger.error('[placement] getAllJobOffers placement query error:', placementError);
      throw placementError;
    }

    // Get unique student IDs from placements
    const studentIds = [...new Set((placements || []).map(p => p.student_id).filter(Boolean))];

    // Fetch student details separately (no FK constraint between placement.student_id and student_basic_details.usn)
    let studentsMap = {};
    if (studentIds.length > 0) {
      const { data: students, error: studentsError } = await supabase
        .from('student_basic_details')
        .select(`
          usn,
          full_name,
          year_of_joining,
          school_id,
          program_id,
          schools(name),
          programs(name)
        `)
        .in('usn', studentIds);

      if (studentsError) {
        logger.error('[placement] getAllJobOffers students query error:', studentsError);
        // Don't throw - continue with empty student data
      } else {
        // Build a map for quick lookup
        (students || []).forEach(s => {
          studentsMap[s.usn] = s;
        });
      }
    }

    // Transform data to match frontend expectations
    const offers = (placements || []).map(p => {
      const student = studentsMap[p.student_id] || null;
      const school = student?.schools;
      const program = student?.programs;
      const company = p.companies;

      return {
        id: p.id,
        usn: student?.usn || p.student_id,
        student_name: student?.full_name || '',
        batch: student?.year_of_joining || null,
        school: school?.name || '',
        program: program?.name || '',
        company_id: p.company_id,
        company_name: company?.company_name || '',
        designation: p.designation,
        job_type: p.type_of_hiring || 'full time',
        ctc_min_lpa: p.ctc_min_lpa,
        ctc_max_lpa: p.ctc_max_lpa,
        ctc: p.ctc_max_lpa || p.ctc_min_lpa, // fallback for display
        ctc_variable_pay: p.ctc_variable_pay,
        ctc_stock_in_lpa: p.ctc_stock_in_lpa,
        offer_letter_status: p.offer_letter_status || 'Pending',
        academic_year: p.academic_year,
        remarks: p.remarks,
        created_at: p.created_at,
        updated_at: p.updated_at
      };
    });

    res.json(offers);
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
    const { data: student, error: studentError } = await supabase
      .from('student_basic_details')
      .select('usn, full_name')
      .eq('usn', b.usn)
      .maybeSingle();

    if (studentError || !student) {
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
    const { data: placementData, error: placementError } = await supabase
      .from('placement')
      .insert(placement)
      .select()
      .single();

    if (placementError) {
      logger.error('addJobOffer placement insert error:', placementError);
      throw placementError;
    }

    // Also insert into offers table (linking table)
    const offer = {
      student_id: b.usn,
      company_id: b.company_id || null,
      placement_id: placementData.id,
      job_type: b.job_type || 'full time',
      academic_year: b.academic_year || new Date().getFullYear().toString(),
      remarks: b.remarks || null,
    };

    const { data: offerData, error: offerError } = await supabase
      .from('offers')
      .insert(offer)
      .select()
      .single();

    if (offerError) {
      logger.warn('addJobOffer offers table insert warning:', offerError);
      // Don't fail if offers table insert fails, placement is the main record
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
 * GET /placement/dashboard/stats
 * Returns dashboard metrics: placementSeeking, totalOffers, totalPlaced, totalInternship, totalInternshipCumFullTime
 */
exports.getDashboardStats = async (req, res) => {
  try {
    // 1. Placement Seeking Students (opt_in = true)
    const { count: placementSeekingCount, error: optInError } = await supabase
      .from('student_basic_details')
      .select('*', { count: 'exact', head: true })
      .eq('opt_in', true);
    
    if (optInError) throw optInError;

    // 2. Offers Metrics
    const { data: offers, error: offersError } = await supabase
      .from('offers')
      .select('student_id, placement_id, capstone_id');

    if (offersError) throw offersError;

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

