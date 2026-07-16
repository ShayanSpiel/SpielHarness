// Mint a BetterAuth session cookie for benchmarking without going through the
// browser. Reads the first unexpired session from the DB, signs it with
// BETTER_AUTH_SECRET, and prints the cookie header value on stdout.

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SECRET = process.env.BETTER_AUTH_SECRET ?? "spielos-dev-secret-change-in-production-abcdef123456";

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is required.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } });

const { makeSignature } = await import(new URL("../node_modules/better-auth/dist/crypto/index.mjs", import.meta.url).pathname);

const rows = await sql`
  select token, "expiresAt"
  from session
  where "expiresAt" > now()
  order by "expiresAt" desc
  limit 1
`;

await sql.end();

if (rows.length === 0) {
  console.error("ERROR: no unexpired session found.");
  process.exit(1);
}

const token = rows[0].token;
const signature = await makeSignature(token, SECRET);
process.stdout.write(`${token}.${signature}`);
