-- Placement / student list performance indexes (safe IF NOT EXISTS)

CREATE INDEX IF NOT EXISTS idx_student_basic_details_usn ON public.student_basic_details (usn);
CREATE INDEX IF NOT EXISTS idx_student_basic_details_school_id ON public.student_basic_details (school_id);
CREATE INDEX IF NOT EXISTS idx_student_basic_details_program_id ON public.student_basic_details (program_id);
CREATE INDEX IF NOT EXISTS idx_student_basic_details_opt_in ON public.student_basic_details (opt_in) WHERE opt_in = true;
CREATE INDEX IF NOT EXISTS idx_student_basic_details_eligible ON public.student_basic_details (is_placement_eligible) WHERE is_placement_eligible = true;
CREATE INDEX IF NOT EXISTS idx_student_basic_details_year_joining ON public.student_basic_details (year_of_joining);
CREATE INDEX IF NOT EXISTS idx_student_basic_details_school_opt_in ON public.student_basic_details (school_id, opt_in);

CREATE INDEX IF NOT EXISTS idx_spp_placement_drive_id ON public.student_placement_process (placement_drive_id);
CREATE INDEX IF NOT EXISTS idx_spp_usn ON public.student_placement_process (usn);
CREATE INDEX IF NOT EXISTS idx_spp_drive_usn ON public.student_placement_process (placement_drive_id, usn);

CREATE INDEX IF NOT EXISTS idx_edl_drive_usn ON public.eligibility_decision_logs (placement_drive_id, usn);

CREATE INDEX IF NOT EXISTS idx_spv_usn_active ON public.student_placement_violations (usn) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sdr_usn_active ON public.student_disciplinary_records (usn) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_user_login_usn_active ON public.user_login (usn) WHERE is_active = true;

-- Academics: prefer student_semester_records; legacy table if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'student_semester_records'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ssr_usn_year_sem ON public.student_semester_records (usn, academic_year DESC, semester DESC)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'student_semester_academics'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ssa_usn_year_sem ON public.student_semester_academics (usn, academic_year DESC, semester DESC)';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_placements_drives_company_id ON public.placements_drives (company_id);
CREATE INDEX IF NOT EXISTS idx_placements_drives_status ON public.placements_drives (placement_status);
CREATE INDEX IF NOT EXISTS idx_placements_drives_event_datetime ON public.placements_drives (event_datetime);

CREATE INDEX IF NOT EXISTS idx_offers_student_id ON public.offers (student_id);
CREATE INDEX IF NOT EXISTS idx_offers_company_id ON public.offers (company_id);
CREATE INDEX IF NOT EXISTS idx_offers_placement_id ON public.offers (placement_id);
CREATE INDEX IF NOT EXISTS idx_offers_capstone_id ON public.offers (capstone_id);

CREATE INDEX IF NOT EXISTS idx_companies_name ON public.companies (company_name);
