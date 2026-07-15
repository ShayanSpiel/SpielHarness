import type { Pool } from "pg";

/**
 * Creates a default org for a newly registered user and makes them the owner.
 * Called from the BetterAuth database hook after user creation.
 * Accepts the BetterAuth pool to avoid creating a duplicate connection.
 */
export async function createDefaultOrgForUser(
  pool: Pool,
  userId: string,
  email: string,
  name: string | null
): Promise<void> {
  const displayName = name || email.split("@")[0] || "User";
  const orgName = `${displayName}'s workspace`;
  const slug = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");

  // Create profile
  await pool.query(
    `INSERT INTO profiles (id, email, display_name, avatar_url)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [userId, email, displayName]
  );

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
