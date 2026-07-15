-- Simplify membership roles to owner + admin only.

-- Drop the default before altering the type
ALTER TABLE org_memberships ALTER COLUMN role DROP DEFAULT;

-- Collapse existing editor/viewer rows into admin
UPDATE org_memberships SET role = 'admin' WHERE role IN ('editor', 'viewer');

-- Recreate the enum without editor/viewer
ALTER TYPE membership_role RENAME TO membership_role_old;
CREATE TYPE membership_role AS ENUM ('owner', 'admin');
ALTER TABLE org_memberships ALTER COLUMN role TYPE membership_role USING role::text::membership_role;
DROP TYPE membership_role_old;

-- Set the new default
ALTER TABLE org_memberships ALTER COLUMN role SET DEFAULT 'admin'::membership_role;
