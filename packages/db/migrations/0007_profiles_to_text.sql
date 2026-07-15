-- Migration 0007: Align profile ID columns with BetterAuth.
--
-- BetterAuth generates TEXT user IDs (e.g. "6kosM8siVmCI8OSXi03xE5hwiLqSUxTs"),
-- not UUIDs. All profile-referencing columns must be TEXT to accept them.

-- 1. Drop foreign keys that reference profiles.id
ALTER TABLE org_memberships DROP CONSTRAINT IF EXISTS org_memberships_profile_id_fkey;
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_created_by_fkey;
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_updated_by_fkey;
ALTER TABLE file_versions DROP CONSTRAINT IF EXISTS file_versions_created_by_fkey;
ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_created_by_fkey;
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_requested_by_fkey;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey;

-- 2. Alter columns from uuid to text
ALTER TABLE profiles ALTER COLUMN id TYPE text;
ALTER TABLE org_memberships ALTER COLUMN profile_id TYPE text;
ALTER TABLE files ALTER COLUMN created_by TYPE text;
ALTER TABLE files ALTER COLUMN updated_by TYPE text;
ALTER TABLE file_versions ALTER COLUMN created_by TYPE text;
ALTER TABLE chats ALTER COLUMN created_by TYPE text;
ALTER TABLE runs ALTER COLUMN requested_by TYPE text;
ALTER TABLE audit_log ALTER COLUMN actor_id TYPE text;

-- 3. Re-add foreign keys
ALTER TABLE org_memberships ADD CONSTRAINT org_memberships_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE files ADD CONSTRAINT files_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE files ADD CONSTRAINT files_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE file_versions ADD CONSTRAINT file_versions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE chats ADD CONSTRAINT chats_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE runs ADD CONSTRAINT runs_requested_by_fkey
  FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- 4. Seed: create profile + default org for every existing BetterAuth user that has no profile
INSERT INTO profiles (id, email, display_name, avatar_url)
SELECT id, email, coalesce(name, split_part(email, '@', 1)), NULL
FROM "user"
WHERE id NOT IN (SELECT id FROM profiles)
ON CONFLICT (id) DO NOTHING;

INSERT INTO orgs (name, slug, metadata)
SELECT
  coalesce(name, split_part(email, '@', 1)) || '''s workspace',
  'ws-' || lower(regexp_replace(coalesce(name, split_part(email, '@', 1)), '[^a-z0-9]', '', 'g')) || '-' || floor(random() * 99999)::text,
  '{}'::jsonb
FROM "user"
WHERE id NOT IN (
  SELECT m.profile_id FROM org_memberships m WHERE m.profile_id IS NOT NULL
)
ON CONFLICT DO NOTHING;

INSERT INTO org_memberships (org_id, profile_id, role)
SELECT o.id, u.id, 'owner'
FROM "user" u
JOIN orgs o ON o.name = coalesce(u.name, split_part(u.email, '@', 1)) || '''s workspace'
WHERE u.id NOT IN (
  SELECT m.profile_id FROM org_memberships m WHERE m.profile_id IS NOT NULL
)
ON CONFLICT (org_id, profile_id) DO NOTHING;
