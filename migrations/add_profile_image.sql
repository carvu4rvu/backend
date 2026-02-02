-- Add profile_image column to student_basic_details table
-- This migration adds support for storing profile image URLs

ALTER TABLE public.student_basic_details 
ADD COLUMN IF NOT EXISTS profile_image text;

-- Add comment to the column
COMMENT ON COLUMN public.student_basic_details.profile_image IS 'URL or path to the student profile image';
