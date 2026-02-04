-- Migration: Add eligibility columns to student_basic_details
-- Date: 2026-02-02

-- Add summer immersion eligibility column
ALTER TABLE public.student_basic_details 
ADD COLUMN IF NOT EXISTS is_summer_immersion_eligible boolean NOT NULL DEFAULT false;

-- Add summer internship eligibility column
ALTER TABLE public.student_basic_details 
ADD COLUMN IF NOT EXISTS is_summer_internship_eligible boolean NOT NULL DEFAULT false;

-- Add capstone eligibility column
ALTER TABLE public.student_basic_details 
ADD COLUMN IF NOT EXISTS is_capstone_eligible boolean NOT NULL DEFAULT false;

-- Add placement eligibility column  
ALTER TABLE public.student_basic_details 
ADD COLUMN IF NOT EXISTS is_placement_eligible boolean NOT NULL DEFAULT false;

-- Create indexes for faster filtering
CREATE INDEX IF NOT EXISTS idx_student_summer_immersion_eligible 
ON public.student_basic_details USING btree (is_summer_immersion_eligible) 
WHERE is_summer_immersion_eligible = true;

CREATE INDEX IF NOT EXISTS idx_student_summer_internship_eligible 
ON public.student_basic_details USING btree (is_summer_internship_eligible) 
WHERE is_summer_internship_eligible = true;

CREATE INDEX IF NOT EXISTS idx_student_capstone_eligible 
ON public.student_basic_details USING btree (is_capstone_eligible) 
WHERE is_capstone_eligible = true;

CREATE INDEX IF NOT EXISTS idx_student_placement_eligible 
ON public.student_basic_details USING btree (is_placement_eligible) 
WHERE is_placement_eligible = true;

-- Add comments for documentation
COMMENT ON COLUMN public.student_basic_details.is_summer_immersion_eligible IS 'Flag indicating if student is eligible for summer immersion';
COMMENT ON COLUMN public.student_basic_details.is_summer_internship_eligible IS 'Flag indicating if student is eligible for summer internship';
COMMENT ON COLUMN public.student_basic_details.is_capstone_eligible IS 'Flag indicating if student is eligible for capstone project';
COMMENT ON COLUMN public.student_basic_details.is_placement_eligible IS 'Flag indicating if student is eligible for placement';
