-- Migration: Add owner_user_id to projects (identity standard: user_id, not USN)
-- Run after projects table exists. Safe to run multiple times (idempotent).
-- Requires: user_login table with id, usn; projects.owner_usn populated.

BEGIN;

-- 1) Add column (nullable first for backfill)
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS owner_user_id bigint;

-- 2) Backfill from user_login (owner_usn -> user_login.usn -> user_login.id)
UPDATE public.projects p
SET owner_user_id = (SELECT ul.id FROM public.user_login ul WHERE ul.usn = p.owner_usn LIMIT 1)
WHERE p.owner_user_id IS NULL AND p.owner_usn IS NOT NULL;

-- 3) Add FK if not already present (avoid duplicate constraint names)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'projects'
    AND constraint_name = 'projects_owner_user_id_fkey'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_owner_user_id_fkey
      FOREIGN KEY (owner_user_id) REFERENCES public.user_login(id);
  END IF;
END $$;

-- 4) Index for list-by-owner and ownership checks
CREATE INDEX IF NOT EXISTS idx_projects_owner_user_id ON public.projects(owner_user_id);

-- 5) Optional: make NOT NULL so all new/updated rows must have owner_user_id.
--    Uncomment only if every project has a matching user_login (no orphan owner_usn).
-- ALTER TABLE public.projects ALTER COLUMN owner_user_id SET NOT NULL;

COMMIT;
