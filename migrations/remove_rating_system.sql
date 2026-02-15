-- Remove rating system from database
-- Run: psql -f backend/migrations/remove_rating_system.sql (or execute in your DB client)

-- 1. Drop project_ratings table (user ratings 1-5)
DROP TABLE IF EXISTS public.project_ratings CASCADE;

-- 2. Remove avg_rating and rating_count from project_metrics
ALTER TABLE public.project_metrics DROP COLUMN IF EXISTS avg_rating;
ALTER TABLE public.project_metrics DROP COLUMN IF EXISTS rating_count;
