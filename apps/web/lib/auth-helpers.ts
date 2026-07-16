import type { Pool } from "pg";

/**
 * Creates a default org for a newly registered user and makes them the owner.
 * Called from the BetterAuth database hook after user creation.
 * Also checks for any pending workspace invitations for this email and auto-accepts them.
 * Accepts the BetterAuth pool to avoid creating a duplicate connection.
 *
 * Each BetterAuth user is keyed by its own `id`. The same email signing
 * in via a second method creates a fresh `user` row, which means a
 * fresh profile row is appropriate too. The helper mirrors existing
 * memberships of any sibling profile (same email) onto the new id so
 * the user keeps access to the workspaces they had under the first
 * sign-in.
 */
export async function createDefaultOrgForUser(
  pool: Pool,
  userId: string,
  email: string,
  name: string | null,
  image?: string | null
): Promise<void> {
  const displayName = name || email.split("@")[0] || "User";
  const orgName = `${displayName}'s workspace`;
  const slug = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");

  // Create a profile row keyed by the BetterAuth user id. The email
  // UNIQUE was dropped in 0017, so a second sign-in for the same
  // email creates a sibling profile instead of colliding.
  await pool.query(
    `INSERT INTO profiles (id, email, display_name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
       updated_at = now()`,
    [userId, email.toLowerCase(), displayName, image ?? null]
  );

  // Accept any pending invitations for this email
  const pendingInvitations = await pool.query<{ id: string; org_id: string; role: string }>(
    `SELECT id, org_id, role::text as role FROM invitations
     WHERE email = $1 AND status = 'pending' AND expires_at > now()`,
    [email.toLowerCase()]
  );

  for (const inv of pendingInvitations.rows) {
    await pool.query(
      `INSERT INTO org_memberships (org_id, profile_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, profile_id) DO NOTHING`,
      [inv.org_id, userId, inv.role]
    );
    await pool.query(
      `UPDATE invitations SET status = 'accepted' WHERE id = $1`,
      [inv.id]
    );
  }

  // Mirror memberships of any sibling profile (same email) onto the
  // new id. This is what gives a user who re-signed-in via a second
  // method access to the workspaces they had under the first sign-in.
  const siblingMemberships = await pool.query<{ org_id: string; role: string }>(
    `SELECT m.org_id, m.role::text as role
       FROM org_memberships m
       JOIN profiles p ON p.id = m.profile_id
      WHERE lower(p.email) = lower($1)
        AND m.profile_id <> $2`,
    [email.toLowerCase(), userId]
  );
  for (const membership of siblingMemberships.rows) {
    await pool.query(
      `INSERT INTO org_memberships (org_id, profile_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, profile_id) DO NOTHING`,
      [membership.org_id, userId, membership.role]
    );
  }

  // Only create a personal workspace if the new user has no orgs at
  // all (no pending invitations, no mirrored memberships).
  if (pendingInvitations.rows.length > 0 || siblingMemberships.rows.length > 0) {
    return;
  }

  // Create org
  const orgResult = await pool.query<{ id: string }>(
    `INSERT INTO orgs (name, slug, metadata)
     VALUES ($1, $2, '{}'::jsonb)
     ON CONFLICT (slug) DO UPDATE SET slug = $2 || '-' || floor(random() * 9999)::text
     RETURNING id`,
    [orgName, slug]
  );

  if (orgResult.rows[0]) {
    const orgId = orgResult.rows[0].id;

    // Make user the owner
    await pool.query(
      `INSERT INTO org_memberships (org_id, profile_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (org_id, profile_id) DO NOTHING`,
      [orgId, userId]
    );
  }
}
