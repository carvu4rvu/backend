-- Migration: student_projects -> projects + project_* tables
-- Run after the new project tables exist.
--
-- Old: student_projects (single table: title, one_line_description, full_description,
--      genre, visibility, project_snaps[], hosted_link, github_repo, views/likes/favorites counts, etc.)
--
-- New project tables (10+):
--   1. projects              <- main row (migrated from student_projects)
--   2. project_assets        <- one IMAGE per project_snaps[] URL (COVER for first, GALLERY rest)
--   3. project_asset_variants (not populated here; app can generate later)
--   4. project_metrics       <- views, likes, favorites, avg_rating from old counts
--   5. project_favorites     (no per-user data in old table; leave empty)
--   6. project_likes         (no per-user data; leave empty)
--   7. project_ratings       (old had self_rating; only aggregate in project_metrics here)
--   8. project_reviews       (leave empty)
--   9. project_share_links   (leave empty)
--  10. project_views         (leave empty)

BEGIN;

-- 0) Add owner_user_id to projects (identity standard: user_id). FK added in add_projects_owner_user_id.sql if needed.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS owner_user_id bigint;

-- 1) Add temporary column to link new projects.id to old student_projects.id
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS _migrated_from_student_project_id bigint;

-- 2) Insert rows from student_projects into projects (skip if already migrated). Set owner_user_id from user_login.
INSERT INTO public.projects (
  owner_usn,
  owner_user_id,
  title,
  short_description,
  description,
  category,
  tags,
  visibility,
  hosted_url,
  github_url,
  mentor_name,
  tech_stack,
  is_verified,
  published_at,
  created_at,
  updated_at,
  priority,
  _migrated_from_student_project_id
)
SELECT
  sp.usn,
  (SELECT ul.id FROM public.user_login ul WHERE ul.usn = sp.usn LIMIT 1),
  sp.title,
  COALESCE(sp.one_line_description, ''),
  sp.full_description,
  sp.genre,
  CASE WHEN sp.genre IS NOT NULL AND sp.genre <> '' THEN ARRAY[sp.genre] ELSE ARRAY[]::text[] END,
  sp.visibility,
  sp.hosted_link,
  sp.github_repo,
  sp.mentor_name,
  COALESCE(sp.technologies, ARRAY[]::text[]),
  COALESCE(sp.is_approved, false),
  CASE WHEN sp.is_approved = true THEN sp.updated_at ELSE NULL END,
  sp.created_at,
  sp.updated_at,
  COALESCE(sp.priority::integer, 1),
  sp.id
FROM public.student_projects sp
WHERE NOT EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.owner_usn = sp.usn AND p.title = sp.title AND p.created_at = sp.created_at
);

-- 3) project_metrics: one row per project (views, likes, favorites from old counts)
INSERT INTO public.project_metrics (
  project_id,
  views,
  likes,
  favorites,
  avg_rating,
  rating_count,
  last_updated
)
SELECT
  p.id,
  COALESCE(sp.views_count, 0),
  COALESCE(sp.likes_count, 0),
  COALESCE(sp.favorites_count, 0),
  -- Old had self_rating 1-10, new is 1-5; approximate: self_rating/2
  CASE WHEN sp.self_rating IS NOT NULL THEN (sp.self_rating::numeric / 2) ELSE 0 END,
  CASE WHEN sp.self_rating IS NOT NULL THEN 1 ELSE 0 END,
  sp.updated_at
FROM public.projects p
JOIN public.student_projects sp ON sp.id = p._migrated_from_student_project_id
ON CONFLICT (project_id) DO UPDATE SET
  views = EXCLUDED.views,
  likes = EXCLUDED.likes,
  favorites = EXCLUDED.favorites,
  avg_rating = EXCLUDED.avg_rating,
  rating_count = EXCLUDED.rating_count,
  last_updated = EXCLUDED.last_updated;

-- 4) project_assets: one IMAGE GALLERY row per URL in project_snaps
INSERT INTO public.project_assets (
  project_id,
  asset_type,
  asset_role,
  original_url,
  position,
  uploaded_at
)
SELECT
  p.id,
  'IMAGE',
  CASE WHEN ord = 1 THEN 'COVER' ELSE 'GALLERY' END,
  snap::text,
  (ord - 1)::integer,
  sp.updated_at
FROM public.projects p
JOIN public.student_projects sp ON sp.id = p._migrated_from_student_project_id,
LATERAL unnest(
  CASE
    WHEN sp.project_snaps IS NULL OR array_length(sp.project_snaps, 1) IS NULL THEN ARRAY[]::text[]
    ELSE sp.project_snaps::text[]
  END
) WITH ORDINALITY AS t(snap, ord);

-- 5) Remove temporary column
ALTER TABLE public.projects
  DROP COLUMN IF EXISTS _migrated_from_student_project_id;

COMMIT;

-- Optional: after verifying data, you can drop or rename the old table:
-- DROP TABLE public.student_projects;
-- Or keep it for rollback and rename: ALTER TABLE public.student_projects RENAME TO student_projects_legacy;
