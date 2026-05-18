-- Normalize roles to lowercase and dedupe case-insensitively.
-- Safe for existing references via user_login.role_id.
-- Run this against your Postgres database (same one used by the backend).

BEGIN;

-- 1) Re-point any user_login rows that reference a duplicate role id
WITH canon AS (
  SELECT lower(name) AS lname, MIN(id) AS keep_id
  FROM roles
  GROUP BY lower(name)
),
dups AS (
  SELECT r.id AS drop_id, c.keep_id
  FROM roles r
  JOIN canon c ON lower(r.name) = c.lname
  WHERE r.id <> c.keep_id
)
UPDATE user_login ul
SET role_id = d.keep_id
FROM dups d
WHERE ul.role_id = d.drop_id;

-- 2) Delete duplicate role rows (now unreferenced by user_login)
WITH canon AS (
  SELECT lower(name) AS lname, MIN(id) AS keep_id
  FROM roles
  GROUP BY lower(name)
),
dups AS (
  SELECT r.id AS drop_id
  FROM roles r
  JOIN canon c ON lower(r.name) = c.lname
  WHERE r.id <> c.keep_id
)
DELETE FROM roles r
USING dups d
WHERE r.id = d.drop_id;

-- 3) Normalize remaining role names to lowercase
UPDATE roles
SET name = lower(btrim(name));

-- 4) Enforce case-insensitive uniqueness going forward
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'roles_name_lower_uniq'
  ) THEN
    CREATE UNIQUE INDEX roles_name_lower_uniq ON public.roles ((lower(name)));
  END IF;
END $$;

-- 5) Ensure all future inserts/updates store lowercase names
CREATE OR REPLACE FUNCTION public.roles_force_lowercase_name()
RETURNS trigger AS $$
BEGIN
  NEW.name := lower(btrim(NEW.name));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_roles_force_lowercase_name'
  ) THEN
    DROP TRIGGER trg_roles_force_lowercase_name ON public.roles;
  END IF;
END $$;

CREATE TRIGGER trg_roles_force_lowercase_name
BEFORE INSERT OR UPDATE ON public.roles
FOR EACH ROW
EXECUTE FUNCTION public.roles_force_lowercase_name();

COMMIT;

