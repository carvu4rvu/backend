-- Enforce exactly 10 digits for student_basic_details.phone_number
-- Run this against your Postgres DB (e.g. Supabase SQL editor or psql).

-- Drop existing check constraint (name is auto-generated as student_basic_details_phone_number_check)
ALTER TABLE public.student_basic_details
  DROP CONSTRAINT IF EXISTS student_basic_details_phone_number_check;

-- Add new constraint: phone_number must be NULL or exactly 10 digits
ALTER TABLE public.student_basic_details
  ADD CONSTRAINT student_basic_details_phone_number_check
  CHECK (phone_number IS NULL OR phone_number ~ '^[0-9]{10}$');
