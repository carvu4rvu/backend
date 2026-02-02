-- Add resume_file column to student_profile_details table
ALTER TABLE public.student_profile_details
ADD COLUMN IF NOT EXISTS resume_file text;
