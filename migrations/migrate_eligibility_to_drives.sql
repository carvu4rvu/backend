-- Migration: Move placement_drive_eligibility into placements_drives.eligibility_criteria
-- Then drop placement_drive_eligibility table.
-- Date: 2026-02-14

-- 1. Add eligibility_criteria JSONB column to placements_drives
ALTER TABLE public.placements_drives
ADD COLUMN IF NOT EXISTS eligibility_criteria jsonb DEFAULT NULL;

-- 2. Migrate data from placement_drive_eligibility to placements_drives (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'placement_drive_eligibility') THEN
    UPDATE public.placements_drives d
    SET eligibility_criteria = sub.criteria
    FROM (
      SELECT
        e.placement_drive_id,
        jsonb_strip_nulls(jsonb_build_object(
      'min_cgpa', e.min_cgpa,
      'max_cgpa', e.max_cgpa,
      'max_active_backlogs', e.max_active_backlogs,
      'max_backlog_history', e.max_backlog_history,
      'eligible_years', CASE WHEN e.eligible_years IS NOT NULL THEN to_jsonb(e.eligible_years) END,
      'eligible_semesters', CASE WHEN e.eligible_semesters IS NOT NULL THEN to_jsonb(e.eligible_semesters) END,
      'allowed_school_ids', CASE WHEN e.allowed_school_ids IS NOT NULL THEN to_jsonb(e.allowed_school_ids) END,
      'allowed_program_ids', CASE WHEN e.allowed_program_ids IS NOT NULL THEN to_jsonb(e.allowed_program_ids) END,
      'allowed_major_ids', CASE WHEN e.allowed_major_ids IS NOT NULL THEN to_jsonb(e.allowed_major_ids) END,
      'allowed_specialization_ids', CASE WHEN e.allowed_specialization_ids IS NOT NULL THEN to_jsonb(e.allowed_specialization_ids) END,
      'joining_years', CASE WHEN e.joining_years IS NOT NULL THEN to_jsonb(e.joining_years) END,
      'graduation_years', CASE WHEN e.graduation_years IS NOT NULL THEN to_jsonb(e.graduation_years) END,
      'allow_already_placed', e.allow_already_placed,
      'max_existing_ctc_lpa', e.max_existing_ctc_lpa,
      'min_new_ctc_lpa', e.min_new_ctc_lpa,
      'min_ctc_multiplier', e.min_ctc_multiplier,
      'count_offcampus_offers', e.count_offcampus_offers,
      'no_disciplinary_action', e.no_disciplinary_action,
      'no_active_placement_violation', e.no_active_placement_violation,
      'admin_override_allowed', e.admin_override_allowed,
      'max_total_offers', e.max_total_offers
    )) AS criteria
      FROM public.placement_drive_eligibility e
    ) sub
    WHERE sub.placement_drive_id = d.id;
  END IF;
END $$;

-- 3. Drop the placement_drive_eligibility table
DROP TABLE IF EXISTS public.placement_drive_eligibility;
