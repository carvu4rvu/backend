-- Semester unlock requests: students request unlock, admin approves with one click.
-- Run this on your Postgres DB.

CREATE TABLE IF NOT EXISTS public.semester_unlock_requests (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  usn text NOT NULL,
  semester integer NOT NULL CHECK (semester >= 1 AND semester <= 8),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamp with time zone DEFAULT now(),
  reviewed_by bigint,
  reviewed_at timestamp with time zone,
  admin_notes text,
  CONSTRAINT semester_unlock_requests_pkey PRIMARY KEY (id),
  CONSTRAINT fk_unlock_request_student FOREIGN KEY (usn) REFERENCES public.student_basic_details(usn) ON DELETE CASCADE,
  CONSTRAINT fk_unlock_request_reviewer FOREIGN KEY (reviewed_by) REFERENCES public.user_login(id) ON DELETE SET NULL
);

-- One pending request per (usn, semester) at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_semester_unlock_requests_pending_unique
  ON public.semester_unlock_requests (usn, semester)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_semester_unlock_requests_usn ON public.semester_unlock_requests (usn);
CREATE INDEX IF NOT EXISTS idx_semester_unlock_requests_status ON public.semester_unlock_requests (status);
CREATE INDEX IF NOT EXISTS idx_semester_unlock_requests_created_at ON public.semester_unlock_requests (created_at DESC);

COMMENT ON TABLE public.semester_unlock_requests IS 'Student requests to unlock a locked semester. Admin approves/rejects with one click.';
