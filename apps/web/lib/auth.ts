import { betterAuth } from "better-auth";
import { Pool } from "pg";

const getCached = <T>(key: string, init: () => T): T => {
  const g = globalThis as unknown as Record<string, T | undefined>;
  if (!g[key]) g[key] = init();
  return g[key]!;
};

const pool = getCached("__auth_pool", () => {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Math.max(1, Number(process.env.AUTH_POOL_MAX) || 3),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    ssl: { rejectUnauthorized: false },
  });
  const id = `auth-${Date.now()}`;
  p.on("error", (err: Error) => console.error(`[pool ${id}] error:`, err.message));
  return p;
});

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      scope: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/analytics.readonly",
      ],
    },
  },
  user: {
    additionalFields: {
      displayName: {
        type: "string",
        required: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            const { createDefaultOrgForUser } = await import("./auth-helpers");
            await createDefaultOrgForUser(pool, user.id, user.email, user.name, user.image);
          } catch (err) {
            console.error("[auth] Failed to create default org:", err);
          }
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
