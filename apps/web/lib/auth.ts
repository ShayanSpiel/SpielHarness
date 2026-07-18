import { betterAuth } from "better-auth";
import { Pool } from "pg";

const getCached = <T>(key: string, init: () => T): T => {
  const g = globalThis as unknown as Record<string, T | undefined>;
  if (!g[key]) g[key] = init();
  return g[key]!;
};

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function isSupabasePoolerHost(host: string): boolean {
  return /pooler\.supabase\.com$/i.test(host) || /supavisor/i.test(host);
}

function isSupabaseDirectHost(host: string): boolean {
  return /^db\.[a-z0-9-]+\.supabase\.co$/i.test(host);
}

function rewriteSupabasePoolerUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (process.env.DATABASE_URL_DIRECT?.trim()) {
      return process.env.DATABASE_URL_DIRECT.trim();
    }
    if (process.env.DATABASE_DIRECT_FROM_POOLER === "0") return connectionString;
    if (!isSupabasePoolerHost(url.hostname.toLowerCase())) return connectionString;
    // Only rewrite the SESSION pooler (port 5432). The transaction pooler
    // (port 6543) is already the right architecture and bypassing it
    // would break the connection when the direct endpoint DNS is not
    // yet propagated.
    const port = url.port
      || (url.protocol === "postgres:" || url.protocol === "postgresql:" ? "5432" : "");
    if (port === "6543") return connectionString;
    const userMatch = url.username.match(/^postgres\.([a-z0-9]+)$/i);
    if (!userMatch) return connectionString;
    const projectRef = userMatch[1];
    url.username = "postgres";
    url.host = `db.${projectRef}.supabase.co`;
    url.port = "5432";
    return url.toString();
  } catch {
    return connectionString;
  }
}

function resolvePoolConfig(connectionString: string | undefined) {
  if (!connectionString) {
    return {
      mode: "session" as const,
      connectionString: undefined as string | undefined,
    };
  }
  const effective = rewriteSupabasePoolerUrl(connectionString);
  try {
    const url = new URL(effective);
    const host = url.hostname.toLowerCase();
    const port = url.port
      || (url.protocol === "postgres:" || url.protocol === "postgresql:" ? "5432" : "");
    if (isSupabasePoolerHost(host)) {
      // pgBouncer in front: server-side prepared statements do not survive
      // connection rotation. We disable the per-client cache and cap
      // server-side work so a stuck connection cannot wedge the request.
      // The `statement_timeout` injection is harmless for the transaction
      // pooler and helps the session pooler.
      const next = new URL(effective);
      next.searchParams.set("options", "-c statement_timeout=10000 -c idle_in_transaction_session_timeout=10000");
      return {
        mode: port === "6543" ? ("transaction" as const) : ("pooler-session" as const),
        connectionString: next.toString(),
      };
    }
    if (isSupabaseDirectHost(host)) {
      return { mode: "direct" as const, connectionString: effective };
    }
    return { mode: "session" as const, connectionString: effective };
  } catch {
    return { mode: "session" as const, connectionString: effective };
  }
}

export const authDatabasePool = getCached("__auth_pool", () => {
  const baseUrl = process.env.DATABASE_URL;
  const config = resolvePoolConfig(baseUrl);
  const p = new Pool({
    connectionString: config.connectionString,
    // Authentication is requested by several app surfaces during an initial
    // workspace load. One connection serializes those reads and causes the
    // pool-acquisition timeouts seen under normal page fan-out. Keep this
    // independently tunable because the safe ceiling depends on the deployed
    // database/pooler plan.
    max: positiveIntegerEnv("AUTH_POOL_MAX", 6),
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: positiveIntegerEnv("AUTH_CONNECT_TIMEOUT_MS", 15_000),
    ssl: { rejectUnauthorized: false },
    query_timeout: positiveIntegerEnv("PG_QUERY_TIMEOUT_MS", 30_000),
    // Keep idle connections alive so the server-side idle reaper
    // (Supabase sets `idle_in_transaction_session_timeout` aggressively
    // on free tier) does not kill sockets the `pg` library still
    // believes are healthy.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000
  });
  const id = `auth-${Date.now()}`;
  const mode = config.mode;
  p.on("error", (err: Error) => {
    console.error(`[pool ${id}] error:`, err.message);
    // `pg` removes the failed client itself. Never drain the whole pool here:
    // Better Auth retains the Pool object passed at construction, so replacing
    // the global cache would leave that live auth instance bound to a closed
    // pool and make every later session lookup fail after a transient socket.
  });
  if (process.env.NODE_ENV !== "production") {
    console.info(`[auth] pool mode=${mode} max=${p.options.max} keepAlive=true`);
  }
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
