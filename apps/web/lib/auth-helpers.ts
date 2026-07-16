import type { Pool } from "pg";

/**
 * Creates a default org for a newly registered user and makes them the owner.
 * Called from the BetterAuth database hook after user creation.
 * Also checks for any pending workspace invitations for this email and auto-accepts them.
 * Accepts the BetterAuth pool to avoid creating a duplicate connection.
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

  // Create profile
  await pool.query(
    `INSERT INTO profiles (id, email, display_name, avatar_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET avatar_url = COALESCE($4, profiles.avatar_url)`,
    [userId, email, displayName, image ?? null]
  );

  // Accept any pending invitations for this email
  const pendingInvitations = await pool.query(
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

  // Only create a personal workspace if there are no pending invitations
  if (pendingInvitations.rows.length > 0) {
    return;
  }

  // Create org
  const orgResult = await pool.query(
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
