-- Phase 4 bugfix: drop profiles.email UNIQUE.
--
-- The schema treated `email` as the natural key for a user, but
-- BetterAuth's `user.id` is the canonical primary key and is generated
-- per sign-in method. The same email signing in via two different
-- providers (Google after a magic link, etc.) creates two `user` rows
-- with different ids, and the old `ON CONFLICT (id) DO UPDATE` in
-- `createDefaultOrgForUser` failed on the email UNIQUE instead.
--
-- Dropping the UNIQUE lets every BetterAuth user have its own profile
-- row. The new `createDefaultOrgForUser` upserts on (id) — each new
-- BetterAuth user gets a fresh profile and the helper mirrors
-- existing memberships to the new id. `getOrg` looks up memberships
-- by the session's userId, which is also the profile id.

alter table profiles drop constraint if exists profiles_email_key;
create index if not exists profiles_email_idx on profiles (lower(email::text));
