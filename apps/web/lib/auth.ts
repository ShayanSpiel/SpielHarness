import { betterAuth } from "better-auth";
import { Pool } from "pg";

const PG_POOL_ID = `auth-pool-${Date.now()}`;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  ssl: { rejectUnauthorized: false },
});

const active = { connections: 0, idle: 0, waiting: 0 };
pool.on("connect", () => {
  active.connections++;
  console.log(`[pool ${PG_POOL_ID}] +connect  active=${active.connections} idle=${active.idle} waiting=${active.waiting}`);
});
pool.on("acquire", () => {
  active.waiting = Math.max(0, active.waiting - 1);
  active.idle = Math.max(0, active.idle - 1);
  console.log(`[pool ${PG_POOL_ID}] +acquire  active=${active.connections} idle=${active.idle} waiting=${active.waiting}`);
});
pool.on("release", (err) => {
  if (err) {
    console.log(`[pool ${PG_POOL_ID}] ~release(err)  active=${active.connections} idle=${active.idle} waiting=${active.waiting} err=${err.message}`);
  } else {
    active.idle++;
    console.log(`[pool ${PG_POOL_ID}] ~release  active=${active.connections} idle=${active.idle} waiting=${active.waiting}`);
  }
});
pool.on("remove", () => {
  active.connections = Math.max(0, active.connections - 1);
  console.log(`[pool ${PG_POOL_ID}] -remove  active=${active.connections} idle=${active.idle} waiting=${active.waiting}`);
});
pool.on("error", (err) => {
  console.error(`[pool ${PG_POOL_ID}] !error  active=${active.connections} idle=${active.idle} waiting=${active.waiting} err=${err.message}`);
});

export const auth = betterAuth({
  database: pool,
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
            await createDefaultOrgForUser(pool, user.id, user.email, user.name);
          } catch (err) {
            console.error("[auth] Failed to create default org:", err);
          }
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
