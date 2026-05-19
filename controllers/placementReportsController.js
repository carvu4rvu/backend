const { buildPlacementReport } = require('../services/placementReportBuilder');
const { buildPlacementReportExcel } = require('../services/placementReportExcelService');
const historyDb = require('../db/placementReportsHistoryDb');
const storageService = require('../services/storageService');
const logger = require('../utils/logger');

function parseDates(req) {
  const dateFrom = req.query.dateFrom || req.query.date_from || req.body?.dateFrom || req.body?.date_from || null;
  const dateTo = req.query.dateTo || req.query.date_to || req.body?.dateTo || req.body?.date_to || null;
  return { dateFrom, dateTo };
}

function defaultReportName(dateFrom, dateTo) {
  if (dateFrom && dateTo) return `Placement Report ${dateFrom} to ${dateTo}`;
  return `Placement Report ${new Date().toISOString().slice(0, 10)}`;
}

function dateOnly(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function mapHistoryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    reportName: row.report_name,
    reportType: row.report_type,
    generatedBy: row.generated_by,
    fromDate: row.from_date,
    toDate: row.to_date,
    storagePath: row.storage_path,
    fileUrl: row.file_url,
    fileSize: row.file_size,
    fileSizeLabel: formatFileSize(Number(row.file_size)),
    generatedAt: row.generated_at,
    status: row.status,
    filters: row.filters_json,
  };
}

/**
 * GET /placement/reports?dateFrom=&dateTo=
 * Preview report JSON (no persistence).
 */
exports.getPlacementReport = async (req, res) => {
  try {
    const { dateFrom, dateTo } = parseDates(req);
    const report = await buildPlacementReport(dateFrom, dateTo);
    res.json(report);
  } catch (err) {
    logger.error('getPlacementReport:', err);
    res.status(500).json({ message: 'Server error generating placement report' });
  }
};

/**
 * POST /placement/reports/generate
 */
exports.generateReport = async (req, res) => {
  let savedRow = null;
  try {
    const { dateFrom, dateTo } = parseDates(req);
    const reportName = req.body?.reportName?.trim() || defaultReportName(dateFrom, dateTo);
    const reportType = req.body?.reportType || 'placement_summary';

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ message: 'dateFrom and dateTo are required' });
    }
    if (new Date(dateFrom) > new Date(dateTo)) {
      return res.status(400).json({ message: 'dateFrom must be before dateTo' });
    }

    const generatedBy = req.user?.email || req.user?.usn || 'Admin';

    savedRow = await historyDb.insertReport({
      report_name: reportName,
      report_type: reportType,
      generated_by: generatedBy,
      generated_by_user_id: req.user?.id || null,
      from_date: dateFrom,
      to_date: dateTo,
      status: 'generating',
      filters_json: { dateFrom, dateTo, reportType },
    });

    const report = await buildPlacementReport(dateFrom, dateTo);
    const excelBuffer = await buildPlacementReportExcel(report);
    const fileName = `placement-report-${dateFrom}-${dateTo}.xlsx`;

    const { url, path: storagePath } = await storageService.uploadPlacementReport(
      excelBuffer,
      savedRow.id,
      fileName
    );

    savedRow = await historyDb.updateReportFile(savedRow.id, {
      storage_path: storagePath,
      file_url: url,
      file_size: excelBuffer.length,
      status: 'ready',
      report_snapshot: report,
    });

    res.status(201).json({
      report,
      saved: mapHistoryRow(savedRow),
    });
  } catch (err) {
    logger.error('generateReport:', err);
    if (savedRow?.id) {
      await historyDb.updateReportFile(savedRow.id, { status: 'failed' }).catch(() => {});
    }
    res.status(500).json({ message: err.message || 'Failed to generate and save report' });
  }
};

/**
 * GET /placement/reports/history
 */
exports.getReportHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = Math.min(parseInt(req.query.limit || '15', 10), 50);
    const result = await historyDb.listReports({
      search: req.query.search || req.query.q || null,
      reportType: req.query.reportType || req.query.report_type || null,
      generatedBy: req.query.generatedBy || req.query.generated_by || null,
      status: req.query.status || null,
      dateFrom: req.query.historyFrom || req.query.history_from || null,
      dateTo: req.query.historyTo || req.query.history_to || null,
      page,
      limit,
      sort: req.query.sort || 'newest',
    });

    res.json({
      items: result.items.map(mapHistoryRow),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  } catch (err) {
    logger.error('getReportHistory:', err);
    res.status(500).json({ message: 'Failed to load report history' });
  }
};

/**
 * GET /placement/reports/:id/view
 */
exports.viewReport = async (req, res) => {
  try {
    const row = await historyDb.getReportById(req.params.id);
    if (!row) return res.status(404).json({ message: 'Report not found' });

    let report = row.report_snapshot;
    if (typeof report === 'string') {
      try {
        report = JSON.parse(report);
      } catch (_) {
        report = null;
      }
    }

    if (!report && row.from_date && row.to_date) {
      report = await buildPlacementReport(dateOnly(row.from_date), dateOnly(row.to_date));
    }

    res.json({
      meta: mapHistoryRow(row),
      report,
    });
  } catch (err) {
    logger.error('viewReport:', err);
    res.status(500).json({ message: 'Failed to load report' });
  }
};

/**
 * GET /placement/reports/:id/download
 */
exports.downloadReport = async (req, res) => {
  try {
    const row = await historyDb.getReportById(req.params.id);
    if (!row) return res.status(404).json({ message: 'Report not found' });
    if (!row.storage_path) {
      return res.status(404).json({ message: 'Report file not available' });
    }

    const buffer = await storageService.downloadPlacementReportBuffer(row.storage_path);
    const safeName = (row.report_name || 'placement-report').replace(/[^\w\s.-]/g, '_');
    const fileName = `${safeName}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    logger.error('downloadReport:', err);
    res.status(500).json({ message: 'Failed to download report' });
  }
};

/**
 * DELETE /placement/reports/:id
 */
exports.deleteReport = async (req, res) => {
  try {
    const row = await historyDb.getReportById(req.params.id);
    if (!row) return res.status(404).json({ message: 'Report not found' });

    if (row.storage_path) {
      await storageService.deletePlacementReportFile(row.storage_path);
    }

    await historyDb.deleteReportById(req.params.id);
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    logger.error('deleteReport:', err);
    res.status(500).json({ message: 'Failed to delete report' });
  }
};
