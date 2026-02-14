-- Migration: Drop placement_academic_year_snapshot table
-- Stats are now computed on-the-fly from live placement data.
-- Date: 2026-02-14

DROP TABLE IF EXISTS public.placement_academic_year_snapshot;
