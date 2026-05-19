const ExcelJS = require('exceljs');

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF172E36' },
};
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const SUBHEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EDF2' },
};
const TITLE_FONT = { bold: true, size: 16, color: { argb: 'FF172E36' } };
const SUBTITLE_FONT = { size: 11, color: { argb: 'FF64748B' } };

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });
  row.height = 22;
}

function autoWidth(sheet, min = 12, max = 48) {
  sheet.columns.forEach((col) => {
    let w = min;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      w = Math.max(w, Math.min(max, len + 2));
    });
    col.width = w;
  });
}

function addTitleBlock(sheet, title, subtitle) {
  sheet.mergeCells('A1:F1');
  const t = sheet.getCell('A1');
  t.value = title;
  t.font = TITLE_FONT;
  sheet.mergeCells('A2:F2');
  const s = sheet.getCell('A2');
  s.value = subtitle;
  s.font = SUBTITLE_FONT;
  sheet.getRow(3).height = 8;
}

function addKvSection(sheet, startRow, pairs) {
  let r = startRow;
  pairs.forEach(([label, value]) => {
    const labelCell = sheet.getCell(`A${r}`);
    labelCell.value = label;
    labelCell.font = { bold: true, color: { argb: 'FF475569' } };
    labelCell.fill = SUBHEADER_FILL;
    sheet.mergeCells(`B${r}:D${r}`);
    sheet.getCell(`B${r}`).value = value ?? '—';
    r += 1;
  });
  return r + 1;
}

/**
 * Build formatted .xlsx buffer from report JSON.
 */
async function buildPlacementReportExcel(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Carve You Placement';
  wb.created = new Date();

  const period =
    report.meta?.dateFrom && report.meta?.dateTo
      ? `${report.meta.dateFrom} to ${report.meta.dateTo}`
      : 'All time';
  const generated = report.meta?.generatedAt
    ? new Date(report.meta.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  // —— Sheet 1: Executive Summary ——
  const exec = wb.addWorksheet('Executive Summary', { views: [{ state: 'frozen', ySplit: 3 }] });
  addTitleBlock(exec, 'Placement Report — Executive Summary', `Period: ${period} · Generated: ${generated}`);
  let row = 4;
  row = addKvSection(exec, row, [
    ['Eligible Students', report.executiveSnapshot?.totalEligible],
    ['Opted In', report.executiveSnapshot?.totalOptedIn],
    ['Placed (Period)', report.executiveSnapshot?.placedThisPeriod],
    ['Placed (Cumulative)', report.executiveSnapshot?.placedCumulative],
    ['Placement Rate (%)', report.executiveSnapshot?.placementRate],
    ['Avg CTC (LPA)', report.executiveSnapshot?.avgCtc],
    ['Median CTC (LPA)', report.executiveSnapshot?.medianCtc],
    ['Max CTC (LPA)', report.executiveSnapshot?.maxCtc],
    ['Min CTC (LPA)', report.executiveSnapshot?.minCtc],
    ['Companies Onboarded', report.executiveSnapshot?.companiesOnboarded],
    ['Active Drives', report.executiveSnapshot?.activeDrives],
    ['Pending Offers', report.executiveSnapshot?.pendingOffers],
  ]);
  row += 1;
  exec.getCell(`A${row}`).value = 'Pipeline Health';
  exec.getCell(`A${row}`).font = { bold: true, size: 12 };
  row += 1;
  row = addKvSection(exec, row, [
    ['Registered', report.pipelineHealth?.registered],
    ['Eligible', report.pipelineHealth?.eligible],
    ['Applied', report.pipelineHealth?.applied],
    ['Interviewed', report.pipelineHealth?.interviewed],
    ['Selected', report.pipelineHealth?.selected],
    ['Placed', report.pipelineHealth?.placed],
  ]);
  autoWidth(exec);

  // —— Sheet 2: Drive Performance ——
  const drives = wb.addWorksheet('Drive Performance');
  addTitleBlock(drives, 'Placement Drive Performance', period);
  const dHeader = drives.getRow(4);
  ['Company', 'Registrations', 'Interviewed', 'Selected', 'Conversion %'].forEach((h, i) => {
    dHeader.getCell(i + 1).value = h;
  });
  styleHeaderRow(dHeader);
  (report.drivePerformance || []).forEach((d, i) => {
    const r = drives.getRow(5 + i);
    r.getCell(1).value = d.company;
    r.getCell(2).value = d.registrations;
    r.getCell(3).value = d.interviewed;
    r.getCell(4).value = d.selected;
    r.getCell(5).value = `${d.conversionRate}%`;
  });
  autoWidth(drives);

  // —— Sheet 3: Companies & Offers ——
  const offers = wb.addWorksheet('Companies & Offers');
  addTitleBlock(offers, 'Company Portfolio & Salary Analytics', period);
  offers.getCell('A4').value = 'CTC Distribution';
  offers.getCell('A4').font = { bold: true };
  const dist = report.offerAnalytics?.ctcDistribution || {};
  row = 5;
  [
    ['< 3 LPA', dist.under3],
    ['3 – 5 LPA', dist.between3and5],
    ['5 – 8 LPA', dist.between5and8],
    ['8+ LPA', dist.above8],
  ].forEach(([label, val], i) => {
    offers.getRow(row + i).getCell(1).value = label;
    offers.getRow(row + i).getCell(2).value = val ?? 0;
  });
  row += 6;
  offers.getCell(`A${row}`).value = 'Placements by Company';
  offers.getCell(`A${row}`).font = { bold: true };
  row += 1;
  const coHeader = offers.getRow(row);
  coHeader.getCell(1).value = 'Company';
  coHeader.getCell(2).value = 'Placements';
  styleHeaderRow(coHeader);
  (report.companyPortfolio?.placementsByCompany || []).forEach((c, i) => {
    const r = offers.getRow(row + 1 + i);
    r.getCell(1).value = c.company;
    r.getCell(2).value = c.count;
  });
  row += (report.companyPortfolio?.placementsByCompany?.length || 0) + 2;
  offers.getCell(`A${row}`).value = 'Top Offers';
  offers.getCell(`A${row}`).font = { bold: true };
  row += 1;
  const topHeader = offers.getRow(row);
  ['USN', 'Company', 'Designation', 'CTC (LPA)'].forEach((h, i) => {
    topHeader.getCell(i + 1).value = h;
  });
  styleHeaderRow(topHeader);
  (report.offerAnalytics?.topOffers || []).forEach((o, i) => {
    const r = offers.getRow(row + 1 + i);
    r.getCell(1).value = o.usn;
    r.getCell(2).value = o.company;
    r.getCell(3).value = o.designation || '—';
    r.getCell(4).value = o.ctc;
  });
  autoWidth(offers);

  // —— Sheet 4: Placement List ——
  const list = wb.addWorksheet('Placement List');
  addTitleBlock(list, 'Placement Data (A–Z)', period);
  const lHeader = list.getRow(4);
  ['#', 'Student', 'USN', 'School', 'Program', 'Company', 'Designation', 'CTC Min', 'CTC Max', 'Type', 'Academic Year'].forEach(
    (h, i) => {
      lHeader.getCell(i + 1).value = h;
    }
  );
  styleHeaderRow(lHeader);
  (report.placementList || []).forEach((p, i) => {
    const r = list.getRow(5 + i);
    r.getCell(1).value = i + 1;
    r.getCell(2).value = p.studentName;
    r.getCell(3).value = p.usn;
    r.getCell(4).value = p.school;
    r.getCell(5).value = p.program;
    r.getCell(6).value = p.company;
    r.getCell(7).value = p.designation || '—';
    r.getCell(8).value = p.ctcMin ?? '—';
    r.getCell(9).value = p.ctcMax ?? '—';
    r.getCell(10).value = p.typeOfHiring || '—';
    r.getCell(11).value = p.academicYear || '—';
  });
  autoWidth(list);

  // —— Sheet 5: Compliance & Readiness ——
  const extra = wb.addWorksheet('Compliance & Events');
  addTitleBlock(extra, 'Compliance, Readiness & Events', period);
  row = 4;
  row = addKvSection(extra, row, [
    ['Policy Violations', report.compliance?.violations],
    ['Disciplinary Records', report.compliance?.disciplinary],
    ['Eligibility Overrides', report.compliance?.eligibilityOverrides],
    ['Students with Resume', report.studentReadiness?.withResume],
    ['With Internship', report.studentReadiness?.withInternship],
    ['With Project', report.studentReadiness?.withProject],
    ['With Certification', report.studentReadiness?.withCertification],
    ['HR Recommendations', report.alumniLeverage?.hrRecommendations],
  ]);
  row += 1;
  const evHeader = extra.getRow(row);
  evHeader.getCell(1).value = 'Event';
  evHeader.getCell(2).value = 'Type';
  evHeader.getCell(3).value = 'Status';
  evHeader.getCell(4).value = 'Date';
  styleHeaderRow(evHeader);
  (report.events || []).forEach((e, i) => {
    const r = extra.getRow(row + 1 + i);
    r.getCell(1).value = e.title;
    r.getCell(2).value = e.type;
    r.getCell(3).value = e.status;
    r.getCell(4).value = e.date ? new Date(e.date).toLocaleDateString('en-IN') : '—';
  });
  autoWidth(extra);

  // —— Sheet 6: Report Metadata ——
  const meta = wb.addWorksheet('Report Metadata');
  addTitleBlock(meta, 'Report Metadata', 'System-generated placement analytics export');
  addKvSection(meta, 4, [
    ['Report Period', period],
    ['Generated At', generated],
    ['Date From', report.meta?.dateFrom || '—'],
    ['Date To', report.meta?.dateTo || '—'],
    ['Total Placements Listed', (report.placementList || []).length],
    ['Drive Records', (report.drivePerformance || []).length],
  ]);
  autoWidth(meta);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { buildPlacementReportExcel };
