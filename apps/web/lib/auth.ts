import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { createPgPoolConfig, _positiveIntegerEnv as positiveIntegerEnv } from "@spielos/db";

const getCached = <T>(key: string, init: () => T): T => {
  const g = globalThis as unknown as Record<string, T | undefined>;
  if (!g[key]) g[key] = init();
  return g[key]!;
};

export const authDatabasePool = getCached("__auth_pool", () => {
  const baseUrl = process.env.DATABASE_URL;
  // When DATABASE_URL is unset, return a pool with no connection string so
  // Better Auth still constructs cleanly — it won't be used for queries.
  if (!baseUrl) {
    return new Pool({ max: 1, min: 0 });
  }
  const poolConfig = createPgPoolConfig(baseUrl, {
    poolMaxOverride: positiveIntegerEnv("AUTH_POOL_MAX", 10),
    poolMinOverride: positiveIntegerEnv("AUTH_POOL_MIN", 1),
    connectionTimeoutMsOverride: positiveIntegerEnv("AUTH_CONNECT_TIMEOUT_MS", 10_000),
  });
  const p = new Pool({
    connectionString: poolConfig.connectionString,
    max: poolConfig.max,
    min: poolConfig.min,
    idleTimeoutMillis: poolConfig.idleTimeoutMillis,
    connectionTimeoutMillis: poolConfig.connectionTimeoutMillis,
    ssl: Object.keys(poolConfig.ssl).length > 0 ? poolConfig.ssl : true,
    query_timeout: poolConfig.query_timeout,
    keepAlive: poolConfig.keepAlive,
    keepAliveInitialDelayMillis: poolConfig.keepAliveInitialDelayMillis,
    ...(poolConfig.options ? { options: poolConfig.options } : {}),
  });
  const id = `auth-${Date.now()}`;
  p.on("error", (err: Error) => {
    const msg = err.message ?? String(err);
    console.error(`[pool ${id}] error: ${msg}`);
  });
  // Warm up the pool so the first request doesn't pay the cold-start penalty.
  p.query("SELECT 1").catch(() => {});
  console.info(`[auth] pool max=${p.options.max} host=${new URL(baseUrl).hostname}`);
  return p;
});
const pool = authDatabasePool;

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
      // App sign-in establishes identity only. Product integrations request
      // their own minimum scopes through the dedicated connector OAuth flow.
      scope: [
        "openid",
        "email",
        "profile"
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
