import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { resolveConnectionString } from "@spielos/db";
import pg from "pg";

const { Pool } = pg;

/**
 * Build a PostgresSaver checkpointer for the Director runtime.
 *
 * The checkpointer owns a deliberately small `pg.Pool` and is cached by
 * canonical connection string, so the first request pays the migration cost
 * while subsequent requests and hot reloads reuse the same setup promise.
 *
 * When `DATABASE_URL` is unavailable (e.g. in unit tests), the
 * builder returns `null` and the Director runtime falls back
 * to the in-memory path inside `createDeepAgent`. The in-memory
 * path is acceptable for tests and local development; production
 * deployments always have `DATABASE_URL` configured.
 */

type SaverCache = Map<string, Promise<BaseCheckpointSaver>>;
const globalCache = globalThis as unknown as {
  __spielosDirectorSavers?: SaverCache;
  __spielosExternalDirectorSavers?: WeakMap<pg.Pool, SaverCache>;
};
const saverCache = globalCache.__spielosDirectorSavers ?? new Map<string, Promise<BaseCheckpointSaver>>();
globalCache.__spielosDirectorSavers = saverCache;
const externalSaverCaches = globalCache.__spielosExternalDirectorSavers ?? new WeakMap<pg.Pool, SaverCache>();
globalCache.__spielosExternalDirectorSavers = externalSaverCaches;

export async function buildPostgresSaver(
  connectionString: string | null | undefined,
  schema: string = "public",
  externalPool?: pg.Pool
): Promise<BaseCheckpointSaver | null> {
  if (!connectionString && !externalPool) return null;
  const effectiveConnectionString = connectionString ? resolveConnectionString(connectionString) : "";
  const poolMax = Math.max(1, Number(process.env.DIRECTOR_CHECKPOINT_POOL_MAX) || 4);
  const connectionTimeoutMillis = 30_000;
  const cache = externalPool
    ? (externalSaverCaches.get(externalPool) ?? (() => {
        const next = new Map<string, Promise<BaseCheckpointSaver>>();
        externalSaverCaches.set(externalPool, next);
        return next;
      })())
    : saverCache;
  const key = externalPool
    ? schema
    : `${effectiveConnectionString}::${schema}::${poolMax}::${connectionTimeoutMillis}`;
  const cached = cache.get(key);
  if (cached) return cached;

  // Cache the setup promise itself. Next.js can fan out multiple Director
  // requests during development/HMR; allowing each one to create a default
  // 10-connection pg pool and race the migrations exhausts small Supabase
  // poolers before the first model token. The explicit pool is intentionally
  // small and uses the same canonical URL resolution as the application DB.
  const setup = (async (): Promise<BaseCheckpointSaver> => {
    const ownedPool = externalPool ? null : new Pool({
      connectionString: effectiveConnectionString,
      max: poolMax,
      min: 0,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis,
      ssl: { rejectUnauthorized: false },
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000
    });
    const pool = externalPool ?? ownedPool!;
    const checkpointer = new PostgresSaver(pool, undefined, { schema });
    try {
      await checkpointer.setup();
      // Strip _summarizationEvent from loaded checkpoints. The JsonPlus
      // serializer serializes HumanMessage (nested inside the event) as a
      // plain object since fast-safe-stringify doesn't call toJSON(), so
      // deserialization produces a plain object that fails
      // z.instanceof(HumanMessage) in deepagents' SummarizationStateSchema.
      // The event is only needed on the turn it was emitted; on subsequent
      // turns the summary message is already in the messages array.
      const originalGetTuple = checkpointer.getTuple.bind(checkpointer);
      checkpointer.getTuple = async (config) => {
        const tuple = await originalGetTuple(config);
        if (tuple?.checkpoint?.channel_values) {
          delete tuple.checkpoint.channel_values._summarizationEvent;
        }
        return tuple;
      };
      return checkpointer;
    } catch (error) {
      if (ownedPool) await ownedPool.end().catch(() => undefined);
      throw error;
    }
  })();
  cache.set(key, setup);
  try {
    return await setup;
  } catch (error) {
    if (cache.get(key) === setup) cache.delete(key);
    throw error;
  }
}

/**
 * Default schema for the Director checkpointer. Uses the
 * public schema so the existing `runs` table and the
 * `langgraph_checkpoints` tables share a single Postgres
 * database. Custom schemas are reserved for future tenant
 * isolation; Phase 4 ships the public-schema path.
 */
export const DEFAULT_CHECKPOINT_SCHEMA = "public";
