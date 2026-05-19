const reportsDb = require('../db/placementReportsDb');

/**
 * Build placement report JSON for a date range (shared by preview, generate, view).
 */
async function buildPlacementReport(dateFrom, dateTo) {
  const fromTs = dateFrom ? `${dateFrom}T00:00:00.000Z` : null;
  const toTs = dateTo ? `${dateTo}T23:59:59.999Z` : null;

  const data = await reportsDb.fetchReportData(fromTs, toTs);
  const {
    placements,
    offers,
    drives,
    companies,
    students,
    processRows,
    eligibilityLogs,
    violations,
    disciplinary,
    events,
    hrRecs,
    schools,
    programs,
    totalPlaced,
    drivesForProcess,
    studentNames,
    studentProfiles,
    studentInterns,
    studentProjs,
    studentCerts,
  } = data;

  const schoolMap = schools.reduce((acc, s) => {
    acc[s.id] = s.name;
    return acc;
  }, {});
  const programMap = programs.reduce((acc, p) => {
    acc[p.id] = p.name;
    return acc;
  }, {});

  const eligibleCount = students.filter((s) => s.is_placement_eligible || s.is_summer_internship_eligible).length;
  const optedInCount = students.filter((s) => s.opt_in).length;
  const placedCount = placements.length;

  const placementsWithCtc = placements
    .map((p) => {
      const ctc = p.ctc_max_lpa != null ? Number(p.ctc_max_lpa) : p.ctc_min_lpa != null ? Number(p.ctc_min_lpa) : null;
      return { ...p, ctc, company: { company_name: p.company_name } };
    })
    .filter((p) => p.ctc != null);
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

  const driveIds = [...new Set(processRows.map((p) => p.placement_drive_id).filter(Boolean))];
  const driveStats = driveIds.map((driveId) => {
    const rows = processRows.filter((p) => p.placement_drive_id === driveId);
    const drive = drivesForProcess.find((d) => d.id === driveId) || drives.find((d) => d.id === driveId);
    const regs = rows.filter((r) => r.registration_status || r.registration_status === 'registered').length || rows.length;
    const interviewed = rows.filter((r) => r.attendance === 'present').length;
    const sel = rows.filter((r) => r.final_select_status === true).length;
    const conv = regs > 0 ? ((sel / regs) * 100).toFixed(1) : 0;
    return {
      driveId,
      company: drive?.company_name || drive?.company?.company_name || 'Unknown',
      registrations: regs,
      interviewed,
      selected: sel,
      conversionRate: conv,
    };
  });

  const newCompaniesInPeriod = companies.length;
  const placementsByCompany = placements.reduce((acc, p) => {
    const name = p.company_name || 'Unknown';
    if (!acc[name]) acc[name] = [];
    acc[name].push(p);
    return acc;
  }, {});

  const nameMap = studentNames.reduce((acc, s) => {
    acc[s.usn] = s.full_name;
    return acc;
  }, {});

  const placementList = placements
    .map((p) => ({
      usn: p.student_id,
      studentName: nameMap[p.student_id] || p.student_id,
      company: p.company_name || 'Unknown',
      designation: p.designation,
      ctcMin: p.ctc_min_lpa,
      ctcMax: p.ctc_max_lpa,
      typeOfHiring: p.type_of_hiring,
      academicYear: p.academic_year,
      createdAt: p.created_at,
    }))
    .sort((a, b) => (a.studentName || '').localeCompare(b.studentName || ''));

  const usns = students.map((s) => s.usn).filter(Boolean);
  const withResume = studentProfiles.length;
  const withInternship = new Set(studentInterns.map((i) => i.usn)).size;
  const withProject = new Set(studentProjs.map((p) => p.usn)).size;
  const withCert = new Set(studentCerts.map((c) => c.usn)).size;

  return {
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
      activeDrives: drives.filter((d) => {
        const s = String(d.placement_status || '').toLowerCase();
        return s === 'ongoing' || s === 'upcoming' || s === 'scheduled';
      }).length,
      pendingOffers: offers.filter((o) => o.is_accepted === null || o.is_accepted === false).length,
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
      placementsByCompany: Object.entries(placementsByCompany).map(([name, arr]) => ({
        company: name,
        count: arr.length,
      })),
    },
    offerAnalytics: {
      ctcDistribution,
      topOffers: placementsWithCtc
        .sort((a, b) => (b.ctc || 0) - (a.ctc || 0))
        .slice(0, 10)
        .map((p) => ({
          usn: p.student_id,
          company: p.company_name,
          ctc: p.ctc,
          designation: p.designation,
        })),
    },
    compliance: {
      violations: violations.length,
      disciplinary: disciplinary.length,
      eligibilityOverrides: eligibilityLogs.filter((l) => l.evaluated_by !== 'SYSTEM').length,
    },
    studentReadiness: {
      totalStudents: usns.length,
      withResume,
      withInternship,
      withProject,
      withCertification: withCert,
      resumePercent: usns.length > 0 ? ((withResume / usns.length) * 100).toFixed(1) : 0,
    },
    events: events.map((e) => ({
      title: e.title,
      type: e.type,
      status: e.status,
      date: e.event_datetime,
    })),
    alumniLeverage: {
      hrRecommendations: hrRecs.length,
    },
    placementList: placementList.map((p) => {
      const st = students.find((s) => s.usn === p.usn);
      return {
        ...p,
        school: schoolMap[st?.school_id] || '-',
        program: programMap[st?.program_id] || '-',
      };
    }),
  };
}

module.exports = { buildPlacementReport };
