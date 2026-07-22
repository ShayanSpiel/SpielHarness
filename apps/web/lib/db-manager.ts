import { createSql, resolveConnectionProfile, type Sql } from "@spielos/db";

// ── Fatal transport error classification ────────────────────────

const FATAL_TRANSPORT_PATTERNS = [
  /CONNECTION_CLOSED/i,
  /CONNECTION_DESTROYED/i,
  /ECONNRESET/i,
  /EPIPE/i,
  /ETIMEDOUT/i,
  /ENETUNREACH/i,
  /EHOSTUNREACH/i,
  /connection.*(closed|reset|refused)/i,
  /terminat/i,
  /write\s+(connection|tcp|socket)/i,
];

function isFatalTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message ?? "";
  return FATAL_TRANSPORT_PATTERNS.some((p) => p.test(msg));
}

// ── Singleton manager ───────────────────────────────────────────

type DbManagerEntry = {
  sql: Sql;
  createdAt: number;
  errors: number;
};

const g = globalThis as unknown as {
  __spielosDbManager?: { entry: DbManagerEntry | null };
};

function getState(): { entry: DbManagerEntry | null } {
  if (!g.__spielosDbManager) {
    g.__spielosDbManager = { entry: null };
  }
  return g.__spielosDbManager;
}

export class DbManager {
  private get entry(): DbManagerEntry | null {
    return getState().entry;
  }

  private set entry(value: DbManagerEntry | null) {
    getState().entry = value;
  }

  getClient(): Sql | null {
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    if (this.entry) return this.entry.sql;
    const sql = createSql(url);
    this.entry = { sql, createdAt: Date.now(), errors: 0 };
    return sql;
  }

  getDiagnostics(): Record<string, unknown> {
    const url = process.env.DATABASE_URL;
    if (!url) return { configured: false };
    const profile = resolveConnectionProfile(url);
    return {
      configured: true,
      host: profile.diagnostic.host,
      port: profile.diagnostic.port,
      mode: profile.diagnostic.mode,
      prepareStatements: profile.diagnostic.prepareStatements,
      poolMax: profile.diagnostic.poolMax,
      poolMin: profile.diagnostic.poolMin,
      ageMs: this.entry ? Date.now() - this.entry.createdAt : 0,
      errors: this.entry?.errors ?? 0,
    };
  }

  async close(): Promise<void> {
    const entry = this.entry;
    if (!entry) return;
    this.entry = null;
    try {
      // postgres.js uses sql.end() for graceful shutdown
      await entry.sql.end({ timeout: 5 });
    } catch {
      // Best-effort close
    }
  }

  invalidate(): void {
    const entry = this.entry;
    if (!entry) return;
    this.entry = null;
    entry.sql.end({ timeout: 2 }).catch(() => {});
  }

  private markError(err: unknown): boolean {
    if (!isFatalTransportError(err)) return false;
    this.entry = this.entry
      ? { ...this.entry, errors: this.entry.errors + 1 }
      : null;
    return true;
  }

  async execute<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    const sql = this.getClient();
    if (!sql) throw new Error("Database is not configured. Set DATABASE_URL.");
    try {
      return await fn(sql);
    } catch (err) {
      if (this.markError(err)) {
        const entry = this.entry;
        if (entry && entry.errors >= 1) {
          this.invalidate();
        }
      }
      throw err;
    }
  }

  // Safe read: retry once on fatal transport error
  async read<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    try {
      return await this.execute(fn);
    } catch (err) {
      if (isFatalTransportError(err)) {
        const sql = this.getClient();
        if (sql) {
          return await fn(sql);
        }
      }
      throw err;
    }
  }
}

let defaultManager: DbManager | null = null;

export function getDbManager(): DbManager {
  if (!defaultManager) defaultManager = new DbManager();
  return defaultManager;
}

export function classifyConnectionError(err: unknown): { status: number; message: string } {
  if (!(err instanceof Error)) return { status: 500, message: "Unknown error" };
  const msg = err.message ?? "";
  if (isFatalTransportError(err)) {
    return {
      status: 503,
      message: "The database connection was interrupted. Please retry.",
    };
  }
  if (/CONNECT_TIMEOUT|connect_timeout|connection.*timed?\s*out/i.test(msg)) {
    return { status: 503, message: "The database connection timed out. Please retry." };
  }
  if (/timeout|TIMEOUT|statement_timeout/i.test(msg)) {
    return { status: 503, message: "The database query timed out. Please retry." };
  }
  return { status: 500, message: msg };
}
