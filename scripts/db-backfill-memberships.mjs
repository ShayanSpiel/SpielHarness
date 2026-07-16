// One-off backfill. Replays the membership mirror for any user
// that signed in via a second method and never got the mirrored
// org_memberships row written. The new BetterAuth user id is in
// `auth.user`; the existing profile is in `public.profiles` keyed
// by email. We (1) create a profile row for the new user id, then
// (2) duplicate every membership of the old profile id to the new
// user id. Safe to re-run; the inserts are ON CONFLICT DO NOTHING.

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL is required."); process.exit(1); }

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } });

try {
  const candidates = await sql`
    select u.id as "userId", u.email, u.name, u.image
    from "user" u
    left join profiles p on p.id = u.id
    where p.id is null
  `;
  console.log(`Found ${candidates.length} BetterAuth user(s) without a profile row.`);
  for (const c of candidates) {
    const displayName = c.name || c.email.split("@")[0] || "User";
    await sql`
      insert into profiles (id, email, display_name, avatar_url)
      values (${c.userId}, ${c.email.toLowerCase()}, ${displayName}, ${c.image ?? null})
      on conflict (id) do nothing
    `;
    console.log(`  created profile ${c.userId} for ${c.email}`);
  }

  const mirrorCandidates = await sql`
    select u.id as "userId", u.email
    from "user" u
    join profiles p on lower(p.email) = lower(u.email)
    where u.id <> p.id
  `;
  console.log(`Found ${mirrorCandidates.length} user(s) whose BetterAuth id differs from a sibling profile.`);
  for (const c of mirrorCandidates) {
    const memberships = await sql`
      select m.org_id, m.role::text as role
      from org_memberships m
      join profiles p on p.id = m.profile_id
      where lower(p.email) = lower(${c.email})
        and m.profile_id <> ${c.userId}
    `;
    console.log(`  user ${c.userId} (${c.email}) — ${memberships.length} membership(s) to mirror`);
    for (const m of memberships) {
      await sql`
        insert into org_memberships (org_id, profile_id, role)
        values (${m.org_id}, ${c.userId}, ${m.role})
        on conflict (org_id, profile_id) do nothing
      `;
    }
  }
  console.log("✓ Done.");
} finally {
  await sql.end({ timeout: 5 });
}
