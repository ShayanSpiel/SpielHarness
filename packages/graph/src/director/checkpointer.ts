import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { createPgPoolConfig } from "@spielos/db";
import pg from "pg";

const { Pool } = pg;

/**
 * Build a PostgresSaver checkpointer for the Director runtime.
 *
 * The checkpointer owns a deliberately small `pg.Pool` and is cached by
 * canonical connection string, so requests reuse the same instance.
 *
 * **Checkpoint tables must already exist.** Schema setup (DDL) happens
 * through numbered migrations or `db:setup-checkpoints` — never at
 * request time.  If the tables are missing, the PostgresSaver constructor
 * will fail with a clear "relation does not exist" error the first time
 * it attempts a read or write.
 *
 * When `DATABASE_URL` is unavailable (e.g. in unit tests), the
 * builder returns `null` and the Director runtime falls back
 * to the in-memory path inside `createDeepAgent`.
 *
 * The `_summarizationEvent` patch is a tested adapter for the JsonPlus
 * serializer's inability to round-trip `HumanMessage` instances that
 * deepagents embeds inside the summarization event.  It is kept here
 * because the PostgresSaver is the only deployment target; if the
 * serializer is fixed upstream the patch can be removed.
 */

type SaverCache = Map<string, Promise<BaseCheckpointSaver>>;
const globalCache = globalThis as unknown as {
  __spielosDirectorSavers?: SaverCache;
};
const saverCache = globalCache.__spielosDirectorSavers ?? new Map<string, Promise<BaseCheckpointSaver>>();
globalCache.__spielosDirectorSavers = saverCache;

export async function buildPostgresSaver(
  connectionString: string | null | undefined,
  schema: string = "public",
): Promise<BaseCheckpointSaver | null> {
  if (!connectionString) return null;

  const poolConfig = createPgPoolConfig(connectionString, {
    poolMaxOverride: Math.max(1, Number(process.env.DIRECTOR_CHECKPOINT_POOL_MAX) || 4),
    poolMinOverride: 0,
    connectionTimeoutMsOverride: 30_000,
  });
  const key = `${poolConfig.connectionString}::${schema}::${poolConfig.max}`;
  const cached = saverCache.get(key);
  if (cached) return cached;

  const setup = (async (): Promise<BaseCheckpointSaver> => {
    const pool = new Pool({
      connectionString: poolConfig.connectionString,
      max: poolConfig.max,
      min: 0,
      idleTimeoutMillis: poolConfig.idleTimeoutMillis,
      connectionTimeoutMillis: poolConfig.connectionTimeoutMillis,
      ssl: poolConfig.ssl as any,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      ...(poolConfig.options ? { options: poolConfig.options } : {}),
    });
    const checkpointer = new PostgresSaver(pool, undefined, { schema });
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
  })();
  saverCache.set(key, setup);
  try {
    return await setup;
  } catch (error) {
    if (saverCache.get(key) === setup) saverCache.delete(key);
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
