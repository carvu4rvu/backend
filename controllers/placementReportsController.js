const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

/**
 * GET /placement/reports?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 * Returns a comprehensive placement report for the date range.
 * Boardroom-ready: Executive snapshot, pipeline, drives, companies, offers, compliance, student readiness, alumni.
 */
exports.getPlacementReport = async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || req.query.date_from || null;
    const dateTo = req.query.dateTo || req.query.date_to || null;

    const fromTs = dateFrom ? `${dateFrom}T00:00:00.000Z` : null;
    const toTs = dateTo ? `${dateTo}T23:59:59.999Z` : null;

    const buildQuery = (table, selectCols = '*', dateCol = 'created_at') => {
      let q = supabase.from(table).select(selectCols);
      if (fromTs) q = q.gte(dateCol, fromTs);
      if (toTs) q = q.lte(dateCol, toTs);
      return q;
    };

    const [
      { data: placements },
      { data: offers },
      { data: drives },
      { data: companies },
      { data: students },
      { data: processRows },
      { data: eligibilityLogs },
      { data: violations },
      { data: disciplinary },
      { data: events },
      { data: hrRecs },
    ] = await Promise.all([
      buildQuery('placement', '*, company:companies(company_name)'),
      buildQuery('offers', '*, company:companies(company_name)'),
      buildQuery('placements_drives', '*, company:companies(company_name)'),
      buildQuery('companies', '*'),
      supabase.from('student_basic_details').select('usn, full_name, school_id, program_id, year_of_joining, opt_in, is_placement_eligible, is_summer_internship_eligible'),
      buildQuery('student_placement_process', '*'),
      buildQuery('eligibility_decision_logs', '*', 'evaluated_at'),
      buildQuery('student_placement_violations', '*'),
      buildQuery('student_disciplinary_records', '*'),
      buildQuery('events', '*'),
      buildQuery('hr_recommendations', '*'),
    ]);

    const { data: schools } = await supabase.from('schools').select('id, name');
    const { data: programs } = await supabase.from('programs').select('id, name, graduation_level');
    const schoolMap = (schools || []).reduce((acc, s) => { acc[s.id] = s.name; return acc; }, {});
    const programMap = (programs || []).reduce((acc, p) => { acc[p.id] = p.name; return acc; }, {});

    const eligibleCount = (students || []).filter((s) => s.is_placement_eligible || s.is_summer_internship_eligible).length;
    const optedInCount = (students || []).filter((s) => s.opt_in).length;
    const placedCount = placements?.length || 0;
    const { count: totalPlaced } = await supabase.from('placement').select('*', { count: 'exact', head: true });

    const placementsWithCtc = (placements || []).map((p) => {
      const ctc = p.ctc_max_lpa != null ? Number(p.ctc_max_lpa) : p.ctc_min_lpa != null ? Number(p.ctc_min_lpa) : null;
      return { ...p, ctc };
    }).filter((p) => p.ctc != null);
    const ctcValues = placementsWithCtc.map((p) => p.ctc).sort((a, b) => a - b);
    const avgCtc = ctcValues.length > 0 ? ctcValues.reduce((a, b) => a + b, 0) / ctcValues.length : 0;
    const medianCtc = ctcValues.length > 0 ? ctcValues[Math.floor(ctcValues.length / 2)] : 0;
    const maxCtc = ctcValues.length > 0 ? Math.max(...ctcValues) : 0;
    const minCtc = ctcValues.length > 0 ? Math.min(...ctcValues) : 0;

    const ctcDistribution = {
      under3: ctcValues.filter((c) => c < 3).length,
      between3and5: ctcValues.filter((c) => c >= 3 && c < 5).length,
      between5and8: ctcValues.filter((c) => c >= 5 && c < 8).length,
      above8: ctcValues.filter((c) => c >= 8).length,
    };

    const registered = processRows.filter((p) => p.registration_status === 'registered' || p.registration_status).length;
    const applied = processRows.length;
    const attended = processRows.filter((p) => p.attendance === 'present').length;
    const selected = processRows.filter((p) => p.final_select_status === true).length;

    const driveIds = [...new Set((processRows || []).map((p) => p.placement_drive_id).filter(Boolean))];
    const { data: drivesForProcess } = driveIds.length > 0
      ? await supabase.from('placements_drives').select('id, company:companies(company_name)').in('id', driveIds)
      : { data: [] };
    const driveStats = driveIds.map((driveId) => {
      const rows = (processRows || []).filter((p) => p.placement_drive_id === driveId);
      const drive = (drivesForProcess || drives || []).find((d) => d.id === driveId);
      const regs = rows.filter((r) => r.registration_status || r.registration_status === 'registered').length || rows.length;
      const interviewed = rows.filter((r) => r.attendance === 'present').length;
      const selected = rows.filter((r) => r.final_select_status === true).length;
      const conv = regs > 0 ? ((selected / regs) * 100).toFixed(1) : 0;
      return {
        driveId,
        company: drive?.company?.company_name || 'Unknown',
        registrations: regs,
        interviewed,
        selected,
        conversionRate: conv,
      };
    });

    const companyIds = [...new Set((placements || []).map((p) => p.company_id).filter(Boolean))];
    const newCompaniesInPeriod = (companies || []).length;
    const placementsByCompany = (placements || []).reduce((acc, p) => {
      const name = p.company?.company_name || 'Unknown';
      if (!acc[name]) acc[name] = [];
      acc[name].push(p);
      return acc;
    }, {});

    const placementList = (placements || []).map((p) => ({
      usn: p.student_id,
      studentName: p.student_id,
      company: p.company?.company_name || 'Unknown',
      designation: p.designation,
      ctcMin: p.ctc_min_lpa,
      ctcMax: p.ctc_max_lpa,
      typeOfHiring: p.type_of_hiring,
      academicYear: p.academic_year,
      createdAt: p.created_at,
    }));

    const { data: studentNames } = await supabase.from('student_basic_details').select('usn, full_name').in('usn', placementList.map((p) => p.usn));
    const nameMap = (studentNames || []).reduce((acc, s) => { acc[s.usn] = s.full_name; return acc; }, {});
    placementList.forEach((p) => { p.studentName = nameMap[p.usn] || p.usn; });
    placementList.sort((a, b) => (a.studentName || '').localeCompare(b.studentName || ''));

    const { data: studentProfiles } = await supabase.from('student_profile_details').select('usn, resume_file');
    const { data: studentInterns } = await supabase.from('student_internships').select('usn');
    const { data: studentProjs } = await supabase.from('projects').select('owner_usn');
    const { data: studentCerts } = await supabase.from('student_certifications').select('usn');
    const usns = (students || []).map((s) => s.usn).filter(Boolean);
    const withResume = (studentProfiles || []).filter((p) => p.resume_file).length;
    const withInternship = new Set((studentInterns || []).map((i) => i.usn)).size;
    const withProject = new Set((studentProjs || []).map((p) => p.owner_usn)).size;
    const withCert = new Set((studentCerts || []).map((c) => c.usn)).size;

    const report = {
      meta: {
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        generatedAt: new Date().toISOString(),
      },
      executiveSnapshot: {
        totalEligible: eligibleCount,
        totalOptedIn: optedInCount,
        placedThisPeriod: placedCount,
        placedCumulative: totalPlaced,
        placementRate: eligibleCount > 0 ? ((placedCount / eligibleCount) * 100).toFixed(1) : 0,
        avgCtc: Math.round(avgCtc * 100) / 100,
        medianCtc: Math.round(medianCtc * 100) / 100,
        maxCtc: Math.round(maxCtc * 100) / 100,
        minCtc: Math.round(minCtc * 100) / 100,
        companiesOnboarded: newCompaniesInPeriod,
        activeDrives: (drives || []).filter((d) => d.placement_status === 'ongoing' || d.placement_status === 'upcoming').length,
        pendingOffers: (offers || []).filter((o) => o.is_accepted === null || o.is_accepted === false).length,
      },
      pipelineHealth: {
        registered: registered || applied,
        eligible: eligibleCount,
        applied,
        interviewed: attended,
        selected,
        placed: placedCount,
      },
      drivePerformance: driveStats,
      companyPortfolio: {
        newCompaniesAdded: newCompaniesInPeriod,
        companiesWithPlacements: Object.keys(placementsByCompany).length,
        placementsByCompany: Object.entries(placementsByCompany).map(([name, arr]) => ({ company: name, count: arr.length })),
      },
      offerAnalytics: {
        ctcDistribution,
        topOffers: placementsWithCtc.sort((a, b) => (b.ctc || 0) - (a.ctc || 0)).slice(0, 10).map((p) => ({
          usn: p.student_id,
          company: p.company?.company_name,
          ctc: p.ctc,
          designation: p.designation,
        })),
      },
      compliance: {
        violations: (violations || []).length,
        disciplinary: (disciplinary || []).length,
        eligibilityOverrides: (eligibilityLogs || []).filter((l) => l.evaluated_by !== 'SYSTEM').length,
      },
      studentReadiness: {
        totalStudents: usns.length,
        withResume: withResume,
        withInternship,
        withProject,
        withCertification: withCert,
        resumePercent: usns.length > 0 ? ((withResume / usns.length) * 100).toFixed(1) : 0,
      },
      events: (events || []).map((e) => ({ title: e.title, type: e.type, status: e.status, date: e.event_datetime })),
      alumniLeverage: {
        hrRecommendations: (hrRecs || []).length,
      },
      placementList: placementList.map((p) => ({
        ...p,
        school: schoolMap[(students || []).find((s) => s.usn === p.usn)?.school_id] || '-',
        program: programMap[(students || []).find((s) => s.usn === p.usn)?.program_id] || '-',
      })),
    };

    res.json(report);
  } catch (err) {
    logger.error('getPlacementReport:', err);
    res.status(500).json({ message: 'Server error generating placement report' });
  }
};
