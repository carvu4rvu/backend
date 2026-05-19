const pool = require('../config/db');

const ensurePlacementReportsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.placement_reports (
        id BIGSERIAL PRIMARY KEY,
        report_name TEXT NOT NULL,
        report_type TEXT NOT NULL DEFAULT 'placement_summary',
        generated_by TEXT,
        generated_by_user_id BIGINT,
        from_date DATE,
        to_date DATE,
        storage_path TEXT,
        file_url TEXT,
        file_size BIGINT DEFAULT 0,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        filters_json JSONB DEFAULT '{}'::jsonb,
        report_snapshot JSONB,
        status TEXT NOT NULL DEFAULT 'ready',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_placement_reports_generated_at
        ON public.placement_reports (generated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_placement_reports_status
        ON public.placement_reports (status);

      CREATE INDEX IF NOT EXISTS idx_placement_reports_generated_by
        ON public.placement_reports (generated_by);

      CREATE INDEX IF NOT EXISTS idx_placement_reports_date_range
        ON public.placement_reports (from_date, to_date);
    `);
  } catch (err) {
    console.warn('ensurePlacementReportsTable:', err.message);
  }
};

module.exports = ensurePlacementReportsTable;
