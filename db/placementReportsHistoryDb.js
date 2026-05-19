const { pool, queryOne, queryMany } = require('./query');

async function insertReport(row) {
  const { rows } = await pool.query(
    `INSERT INTO placement_reports (
      report_name, report_type, generated_by, generated_by_user_id,
      from_date, to_date, storage_path, file_url, file_size,
      filters_json, report_snapshot, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
    RETURNING *`,
    [
      row.report_name,
      row.report_type || 'placement_summary',
      row.generated_by || null,
      row.generated_by_user_id || null,
      row.from_date || null,
      row.to_date || null,
      row.storage_path || null,
      row.file_url || null,
      row.file_size || 0,
      JSON.stringify(row.filters_json || {}),
      row.report_snapshot ? JSON.stringify(row.report_snapshot) : null,
      row.status || 'ready',
    ]
  );
  return rows[0];
}

async function updateReportFile(id, { storage_path, file_url, file_size, status, report_snapshot }) {
  const { rows } = await pool.query(
    `UPDATE placement_reports
     SET storage_path = COALESCE($2, storage_path),
         file_url = COALESCE($3, file_url),
         file_size = COALESCE($4, file_size),
         status = COALESCE($5, status),
         report_snapshot = COALESCE($6::jsonb, report_snapshot),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      storage_path,
      file_url,
      file_size,
      status,
      report_snapshot ? JSON.stringify(report_snapshot) : null,
    ]
  );
  return rows[0];
}

async function getReportById(id) {
  return queryOne('SELECT * FROM placement_reports WHERE id = $1', [id]);
}

async function deleteReportById(id) {
  const { rowCount } = await pool.query('DELETE FROM placement_reports WHERE id = $1', [id]);
  return rowCount > 0;
}

async function listReports({
  search,
  reportType,
  generatedBy,
  status,
  dateFrom,
  dateTo,
  page = 1,
  limit = 15,
  sort = 'newest',
}) {
  const conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (search) {
    conditions.push(`(report_name ILIKE $${idx} OR generated_by ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx += 1;
  }
  if (reportType) {
    conditions.push(`report_type = $${idx}`);
    params.push(reportType);
    idx += 1;
  }
  if (generatedBy) {
    conditions.push(`generated_by ILIKE $${idx}`);
    params.push(`%${generatedBy}%`);
    idx += 1;
  }
  if (status) {
    conditions.push(`status = $${idx}`);
    params.push(status);
    idx += 1;
  }
  if (dateFrom) {
    conditions.push(`generated_at >= $${idx}::date`);
    params.push(dateFrom);
    idx += 1;
  }
  if (dateTo) {
    conditions.push(`generated_at < ($${idx}::date + interval '1 day')`);
    params.push(dateTo);
    idx += 1;
  }

  const where = conditions.join(' AND ');
  const offset = (Math.max(1, page) - 1) * limit;

  let orderBy = 'generated_at DESC';
  if (sort === 'oldest') orderBy = 'generated_at ASC';
  else if (sort === 'name') orderBy = 'report_name ASC';
  else if (sort === 'size') orderBy = 'file_size DESC NULLS LAST';

  const countRow = await queryOne(
    `SELECT COUNT(*)::int AS total FROM placement_reports WHERE ${where}`,
    params
  );

  const rows = await queryMany(
    `SELECT id, report_name, report_type, generated_by, from_date, to_date,
            storage_path, file_url, file_size, generated_at, status, filters_json
     FROM placement_reports
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return {
    items: rows,
    total: countRow?.total ?? 0,
    page: Math.max(1, page),
    limit,
    totalPages: Math.ceil((countRow?.total ?? 0) / limit) || 1,
  };
}

module.exports = {
  insertReport,
  updateReportFile,
  getReportById,
  deleteReportById,
  listReports,
};
