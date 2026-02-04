-- Table to track student-to-alumni conversion (role change + personal email login creation).
-- Run this on your Postgres DB (same as user_login).
-- If you removed UNIQUE on user_login.usn, ensure that is done separately.

CREATE TABLE IF NOT EXISTS public.alumni_conversion_log (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
  usn text NOT NULL,
  rvu_email text NOT NULL,
  personal_email text NOT NULL,
  role_converted boolean DEFAULT false,
  personal_mail_row_created boolean DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'reverted')),
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT alumni_conversion_log_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_alumni_conversion_log_batch_id ON public.alumni_conversion_log (batch_id);
CREATE INDEX IF NOT EXISTS idx_alumni_conversion_log_usn ON public.alumni_conversion_log (usn);
CREATE INDEX IF NOT EXISTS idx_alumni_conversion_log_status ON public.alumni_conversion_log (status);

COMMENT ON TABLE public.alumni_conversion_log IS 'Tracks each student-to-alumni conversion: role change on RVU email and new login row for personal email. Enables revert on failure.';
