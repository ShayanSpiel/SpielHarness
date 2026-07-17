/**
 * Director runtime tool context.
 *
 * Each tool wrapper bridges the deepagents tool call to the
 * existing SpielOS runtime paths. The runtime owns:
 *   - `executeWorkflow` → `streamRun` with `parent_run_id` lineage
 *   - `executeSkill`    → the existing graph runtime for the skill
 *   - `executeEval`     → the existing `executeEval` path
 *
 * The tool wrapper does not write a new `runs` row in any other
 * way. The harness's existing run-registry and durable checkpoint
 * code apply; the child run inherits the parent's `chat_id`,
 * `project_id`, and `turn_id` so chat hydration is unchanged.
 *
 * The bridge is defined as a callback type so the runtime can
 * inject database-bound implementations while keeping the
 * deepagents agent decoupled from `@spielos/db`.
 */

export type DirectorToolContext = {
  executeWorkflow: (args: { workflowId: string; input: Record<string, unknown> }) => Promise<string>;
  executeSkill: (args: { skillId: string; input: string }) => Promise<string>;
  executeEval: (args: { evalId: string; input: string }) => Promise<string>;
};

/**
 * No-op tool context. Used in tests and in the Phase 2 stub where
 * the Director runtime is wired but the tool callbacks are not
 * yet bound. Calls return a structured "not wired" error so the
 * Director's plan loop fails fast and surfaces the missing wiring
 * to the user instead of silently succeeding.
 */
export function noopToolContext(): DirectorToolContext {
  return {
    executeWorkflow: async ({ workflowId }) => JSON.stringify({ error: `Workflow tool not wired for "${workflowId}".` }),
    executeSkill: async ({ skillId }) => JSON.stringify({ error: `Skill tool not wired for "${skillId}".` }),
    executeEval: async ({ evalId }) => JSON.stringify({ error: `Eval tool not wired for "${evalId}".` })
  };
}
