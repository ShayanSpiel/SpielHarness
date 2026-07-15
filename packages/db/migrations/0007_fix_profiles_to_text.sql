-- Change profiles.id and all foreign keys from uuid to text to accept BetterAuth IDs.
-- BetterAuth generates TEXT IDs (not UUIDs), so the existing uuid columns reject them.

ALTER TABLE profiles ALTER COLUMN id TYPE text;
ALTER TABLE org_memberships ALTER COLUMN profile_id TYPE text;
ALTER TABLE files ALTER COLUMN created_by TYPE text;
ALTER TABLE files ALTER COLUMN updated_by TYPE text;
ALTER TABLE file_versions ALTER COLUMN created_by TYPE text;
ALTER TABLE chats ALTER COLUMN created_by TYPE text;
ALTER TABLE runs ALTER COLUMN requested_by TYPE text;
ALTER TABLE audit_log ALTER COLUMN actor_id TYPE text;

-- Now run the auth hook manually for the existing BetterAuth user
INSERT INTO profiles (id, email, display_name, avatar_url)
SELECT id, email, split_part(email, '@', 1), NULL
FROM "user"
ON CONFLICT (id) DO NOTHING;

-- Create default org for the user
WITH new_org AS (
  INSERT INTO orgs (name, slug, metadata)
  SELECT split_part(email, '@', 1) || '''s workspace',
         regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9]', '', 'g'),
         '{}'::jsonb
  FROM "user"
  ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug || '-' || floor(random() * 9999)::text
  RETURNING id
)
INSERT INTO org_memberships (org_id, profile_id, role)
SELECT new_org.id, "user".id, 'owner'
FROM new_org, "user"
ON CONFLICT (org_id, profile_id) DO NOTHING;
