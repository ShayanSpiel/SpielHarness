import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunEvent } from "@spielos/core";

export function createRunEventBuffer(supabase: SupabaseClient, orgId: string, runId: string, batchSize = 20) {
  let pending: Array<Record<string, unknown>> = [];
  async function flush() {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    const { error } = await supabase.from("run_events").insert(batch);
    if (error) throw error;
  }
  return {
    async push(event: RunEvent) {
      pending.push({
        org_id: orgId,
        run_id: runId,
        event_type: event.type,
        node: event.node ?? null,
        skill: event.skill ?? null,
        message: event.message,
        payload: event.payload
      });
      if (pending.length >= batchSize) await flush();
    },
    flush
  };
}
