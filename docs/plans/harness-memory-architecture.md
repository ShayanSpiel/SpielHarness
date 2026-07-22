# SpielOS Harness + Memory Architecture

> Captures conversations, debates, tool-picking journeys, decision rationales, and the full implementation roadmap for context management, memory, and execution architecture.

---

## Table of Contents

1. [Current State (as of July 2026)](#1-current-state)
2. [The Core Question: Why Only 1 Harness Item in Chat?](#2-why-only-one-harness-item)
3. [Chat Assistant Capabilities: Can It Create/Edit Items?](#3-chat-assistant-capabilities)
4. [The Memory Debate: What to Build First](#4-memory-debate)
5. [Frontier Research Surveyed](#5-frontier-research)
6. [GPT-5.6 Sol Deep Dive](#6-gpt-56-sol-deep-dive)
7. [Memory Types Taxonomy](#7-memory-types-taxonomy)
8. [Current Execution Architecture](#8-current-execution-architecture)
9. [Dependency Analysis: What Blocks What](#9-dependency-analysis)
10. [Implementation Roadmap](#10-implementation-roadmap)
11. [Key Decisions & Rationale](#11-key-decisions)
12. [Files Referenced](#12-files-referenced)
13. [Research Papers & Sources](#13-research-sources)

---

## 1. Current State (as of July 2026)

### What Exists

| Area | Status |
|------|--------|
| **Auth** | ✅ Implemented with `better-auth`. Google OAuth sign-in. Session tokens (7-day expiry, 1-day rotation). `getOrg()` resolves user + org from session cookies. `requireRole()` enforces owner/admin permissions server-side. |
| **LangGraph** | ✅ Updated to `@langchain/langgraph` v0.2.74 / `@langchain/core` v0.3.80. 1580 lines. Fan-out/join, eval retry loops, human checkpoints, skill phases, workflow gates. |
| **Provider adapters** | ✅ OpenAI, Anthropic, Mistral, openai-compatible. Streaming support. No `tools` parameter in any adapter. No function calling. |
| **Multi-tenancy** | ✅ DB-level: `org_id` on every table with composite FKs (`0002_tenant_integrity.sql`). Auth resolves org from session. Not hardcoded to demo org anymore. |
| **Context items** | ❌ Ephemeral React state (`useState<ContextItem[]>([])`). Lost on page refresh. |
| **Token counting** | ❌ Zero. No awareness of context budget at any layer. |
| **Compaction** | ❌ None. No summarization, no eviction, no pruning beyond 20-msg hard truncation. |
| **Cross-session memory** | ❌ None. Each chat starts fresh. No embeddings, no vector store, no episodic/semantic memory. |
| **Sub-graphs / sub-agents** | ❌ Single flat `StateGraph` per run. No nested graph delegation. |
| **Parallel execution** | ❌ Skills execute sequentially within nodes. Fan-out branches depend on LangGraph scheduler but no explicit `Promise.all`. |
| **Conditional routing** | ❌ Router always takes `outgoing[0].target`. No output-based branching. |
| **SSE multiplexing** | ❌ Single ordered stream per run. No per-node separate channels. |
| **Checkpointing** | ⚠️ Custom `RunCheckpoint` JSONB in `runs.state`. Works for human-input resume but no LangGraph native checkpointing (`MemorySaver`, `PostgresSaver`). |
| **SSE streaming** | ✅ Single `ReadableStream` per run with frames: `run`, `event`, `artifact`, `text`, `status`, `human_input`, `error`, `done`. |
| **Buffer API** | ✅ MCP tools available (`buffer_buffer_api_help`, `buffer_use_buffer_api`). Used by content pipeline workflows. |

### Key Architecture Files

- `apps/web/lib/server.ts` — `getOrg()`, session resolution, role enforcement
- `apps/web/lib/auth.ts` — `betterAuth` configuration, Google OAuth, auto-provisioning
- `apps/web/lib/auth-client.ts` — client-side auth client
- `apps/web/lib/auth-helpers.ts` — `createDefaultOrgForUser` hook
- `apps/web/lib/execution-service.ts` — `resolveExecution()`, harness loading, director prompt
- `apps/web/lib/chat-adapter.ts` — client-side chat streaming, context mapping
- `apps/web/lib/run-context.tsx` — ephemeral React context state
- `packages/graph/src/index.ts` — LangGraph runtime, node executors, checkpointing
- `packages/providers/src/openai.ts` — OpenAI adapter (no `tools` parameter)
- `packages/providers/src/anthropic.ts` — Anthropic adapter
- `packages/providers/src/types.ts` — `ChatRequest`, `ChatAdapter` interface (no tools)
- `packages/db/migrations/0001_init.sql` — DB schema
- `packages/db/migrations/0002_tenant_integrity.sql` — Multi-tenant FKs

### DB Schema (relevant tables)

```sql
chats (id, org_id, title, metadata, created_by, created_at, updated_at, archived_at)
chat_messages (id, org_id, chat_id, role, body, metadata, created_at) -- NO token count
runs (id, org_id, chat_id, type, prompt, status, inputs JSONB, outputs JSONB, state JSONB, ...)
run_events (id, org_id, run_id, event_type, sequence, node_id, message, payload JSONB, created_at)
run_input_files (org_id, run_id, file_id, relationship)
run_output_files (org_id, run_id, file_id, relationship)
files (id, org_id, file_type, status, title, body, search_vector tsvector, ...) -- has fulltext search
```

---

## 2. Why Only One Harness Item in Chat?

**By design, not a bug.** Enforced at three independent layers:

### Layer 1: UI (context-picker.tsx)

File: `apps/web/components/chat/context-picker.tsx` (around line 98-119)

```typescript
function conflictReason(candidate: Candidate) {
  const executable = run.contextItems.map((item) => item.kind);
  const hasWorkflow = executable.includes("workflow");
  const hasRole = executable.includes("role");
  const hasSkill = executable.includes("skill");
  const hasEval = executable.includes("eval");

  if (candidate.kind === "workflow" && (hasWorkflow || hasRole || hasSkill || hasEval))
    return "Workflows run by themselves. Remove other executable targets first.";
  if (hasWorkflow && ["role", "skill", "eval"].includes(candidate.kind))
    return "A workflow already controls its roles and skills.";
  if (candidate.kind === "role" && hasRole) return "Only one role can be selected.";
  if (candidate.kind === "skill" && hasSkill) return "Only one direct skill can be selected.";
  if (candidate.kind === "eval" && (hasEval || hasRole || hasSkill || hasWorkflow))
    return "Run an evaluation separately or as a workflow gate.";
  if (hasEval && ["role", "skill", "workflow"].includes(candidate.kind))
    return "Evaluation runs are exclusive in chat.";
  return null;
}
```

Rules:
- 1 role maximum
- 1 skill maximum
- Workflows are solo (no other executable alongside)
- Evals are solo (no other executable alongside)
- Unlimited passive context files (knowledge, library, strategy, prompts)

### Layer 2: Client Chat Adapter (chat-adapter.ts)

```typescript
// Only the FIRST executable target is used (singular!)
const explicit = ctx.contextItems.find((item) =>
  ["role", "skill", "eval", "workflow"].includes(item.kind)
);
```

Uses `.find()` not `.filter()` — silently takes first executable target even if multiple somehow got through.

### Layer 3: Server API (execution-service.ts)

```typescript
export type ExecuteBody = {
  targetId?: string;      // singular for role/skill/eval
  workflowId?: string;    // singular for workflow
  contextFileIds?: string[];  // ARRAY — unlimited files
};
```

`targetId` and `workflowId` are single strings. One run = one execution path.

### What IS Allowed

Multiple passive context files (knowledge, library, strategy, prompts) alongside one executable target. These show up as chips in the composer without restriction. The reasoning is semantic — a single run executes one workflow/role/skill/eval at a time. Running multiple would require orchestration logic that doesn't exist yet.

---

## 3. Chat Assistant Capabilities: Can It Create/Edit Items?

### Current State: No. Zero capability.

| Barrier | Evidence |
|---------|----------|
| No function calling | `ChatRequest` has no `tools` or `functions` field. `ChatAdapter` interface has no tool support. |
| No API endpoints | Chat CRUD stores messages only. No item mutation via chat. |
| Orchestrator prompt restricts | "Do not invent hidden tools, hidden agents, private data, or external side effects." |
| No tool definitions | No schemas for `create_role`, `edit_skill`, `create_workflow`, etc. |
| No parallel tool calling | Even if tools existed, the adapter processes one token stream with no multi-call orchestration. |

### What It CAN Do Today

- Natural conversation
- Execute selected roles/skills/evals/workflows
- Generate artifacts (drafts, eval reports) saved as files
- Ask structured human-input questions
- Search knowledge (via `knowledge_search` skill)
- Make read-only HTTP calls (via `http` skill)
- Conversation awareness via `@` mentions (textual, not context items)

### What It CANNOT Do

- Create/edit roles, skills, evals, workflows, templates, prompts
- Modify harness configuration
- Any write operation on harness items
- Access external systems in write mode (blocked by provider adapter confirmation)

### Why This Exists

The architecture intentionally separates:
- **User-managed configuration** (harness items) ← created through UI
- **Assistant-generated content** (artifacts/files) ← created through runs

This was a conscious decision to maintain clear separation between what the user controls and what the assistant generates.

### The "Why Not?" Debate

**Argument for:** Chat-based creation dramatically reduces friction. Users can say "create a skill that searches documentation and summarizes results" instead of navigating the UI. GPT-5.6 Sol validated this pattern with programmatic tool calling.

**Argument against:** Safety. An assistant with write access could accidentally delete or corrupt harness items. Need guardrails: human confirmation for destructive edits, diff previews for creates.

**Resolution:** Tool calling for harness creation is Phase 3. It requires:
1. First: `tools` parameter in provider adapters (parallel tool calls)
2. Then: Tool definitions for CRUD operations
3. Then: Human-in-the-loop for destructive operations
4. Then: Multi-turn tool orchestration

---

## 4. The Memory Debate: What to Build First

### The Question Posed

> "Do we need sub-graphs/sub-agents before memory? Or do we need parallel execution and multi-tenant run savings first?"

### The Answer

**No. Sub-graphs are not a memory prerequisite.**

| Capability | Requires sub-graphs? | Dependency |
|------------|---------------------|------------|
| Token counting | No | Standalone utility |
| Basic compaction | No | Works on message history above the graph |
| Context items persistence | No | DB CRUD + state restore |
| Cross-session memory | No | DB tables + embeddings |
| Harness item creation (chat) | No | Tool definitions + adapter changes |
| Parallel skill execution | Partially | LangGraph fan-out works, but explicit parallel scheduling needed for true concurrency |
| Multi-agent orchestration | Yes | Nested graphs, state isolation, SSE multiplexing |
| Conditional routing | No | Router function changes only |

### The Dependency Chain That Matters

```
Layer 0: Foundations (missing today)
├── Auth                            ✅ DONE (better-auth)
├── Multi-tenancy                   ✅ DONE (org_id everywhere)
├── Token counting                  ❌ — enables context budget awareness
├── Context items persistence       ❌ — enables cross-session state
│
Layer 1: Context Management (enables memory)
├── Compaction                      ❌ — prevents overflow
├── History management              ❌ — token-aware loading, not 20-msg hard limit
│
Layer 2: Memory (cross-session intelligence)
├── Episodic memory                 ❌ — what happened in past runs
├── Semantic memory                 ❌ — distilled facts/preferences
├── Vector embeddings               ❌ — retrieval
│
Layer 3: Advanced Execution (parallel to memory, not blocking)
├── Tool calling (harness creation) ❌
├── Parallel node execution         ❌
├── Sub-graphs/sub-agents           ❌
└── Conditional routing             ❌
```

### The Critical Insight

Memory built without context management is sand:
- You store memories but can't inject them into context because you don't know your budget
- You retrieve relevant episodes but overflow the window because you have no compaction
- Context items vanish on refresh so there's no base state to build on

**Layers 0-1 must precede Layer 2.**

---

## 5. Frontier Research Surveyed

We conducted a world-class survey of 2025-2026 research on context management, compaction, and memory for LLM agents. Here's what we found:

### Context Compaction Techniques

| Technique | Source | Approach | Key Result |
|-----------|--------|----------|------------|
| **CompactionRL** | arXiv 2607.05378, deployed in GLM-5.2 RL pipeline | RL trains model to summarize + execute jointly via PPO with token-level loss normalization and cross-trajectory GAE | +7pp on SWE-bench Verified, +3.1pp on Terminal-Bench 2.0 |
| **MemAct** | ACL 2026 Findings | RAM is action space. Model learns `prune`, `insert`, `summarize` as policy actions via Dynamic Context Policy Optimization (DCPO) | 14B matches 235B accuracy at 51% less context |
| **CWL (Context Window Lifecycle)** | arXiv 2606.11213 | Typed dependency-linked episodes. LLM-free deterministic eviction policy by priority (user turns > active reasoning > recoverable action episodes) | 89 sequential tasks across 80M tokens with zero degradation |
| **Memex / MemexRL** | arXiv 2603.04257 | Indexed experience memory: compact indexed summary in context, full-fidelity artifacts archived under stable indices. Agent dereferences exact past evidence on demand | Less lossy than summary-only. Bounded dereferencing with bounded context. |
| **LCM (Lossless Context Management)** | arXiv 2605.04050 | Hierarchical summary DAG with lossless pointers to every original. Engine-managed parallel primitives (LLM-Map) replace model-written loops | Beats Claude Code on OOLONG. 2 deterministic mechanisms: recursive compression + task partitioning. |
| **Parallel Compaction** | arXiv 2605.23296 | Block-based parallel LLM summarization. Operator controls summary volume via block count. Predictable, fine-grained | Reduces wall time vs sequential. Works across 8B-120B models. |
| **SelfCompact** | arXiv 2606.23525 | Agent decides when to compact using lightweight rubric (sub-task resolved = compact, mid-derivation = wait). No fine-tuning. | Matches or exceeds fixed-interval at 30-70% lower per-question cost. |
| **SUPO** | ACL 2026 | Summarization-augmented Policy Optimization. Jointly trains tool-use + summarization under standard LLM RL infrastructure | Improves success rate while maintaining or reducing working context length. |
| **Active Context Compression (Focus)** | arXiv 2601.07190 | Agent-centric. Model calls `start_focus`/`complete_focus` to consolidate + prune. Sawtooth context pattern (grows during exploration, collapses during consolidation). | 22.7% token reduction (14.9M -> 11.5M) at identical accuracy on SWE-bench Lite (3/5). |
| **STAE** | OpenReview | Semantic-Temporal Aware Eviction. Embedding-space centroid + recency scoring. Evict highest redundancy first. Local STAE within groups outperforms global. | 20-needle benchmark. Local STAE dominates global at matched compression rates. |

### Frontier Model Capabilities

| Provider | Context | Memory | Compaction |
|----------|---------|--------|------------|
| **Claude Opus 4.8 / Fable 5** | 1M tokens | `/memories` directory cross-session. `context_awareness` auto-tracks remaining budget. | Server-side managed compaction at ~85%. `/v1/messages/compact` endpoint (limited preview). |
| **GPT-5.6 Sol** | 1.05M tokens | `reasoning.context` for persisted reasoning across turns. No native cross-session memory. | Compaction listed in API. Prompt caching (30-min TTL, 90% read discount). |
| **Gemini 3.1 Ultra** | 2M tokens | Per-minute storage caching. No native memory. | Context caching with storage fee model. |

---

## 6. GPT-5.6 Sol Deep Dive

Released July 9, 2026. Our research covered this extensively because it represents the frontier of what's possible.

### Three-Tier Family

| Tier | Price (in/out per MTok) | Best for |
|------|------------------------|----------|
| **Sol** | $5 / $30 | Frontier reasoning, complex agents, long-horizon tasks |
| **Terra** | $2.50 / $15 | Balanced everyday work, GPT-5.5-class at half cost |
| **Luna** | $1 / $6 | High-volume classification, extraction, routine transforms |

### New Capabilities Relevant to SpielOS

#### Ultra Multi-Agent Mode

Instead of one agent, Sol Ultra spawns 4 parallel sub-agents (configurable up to 16) that **communicate mid-task** and synthesize a single answer. This is not just a reasoning dial — it's an architecture shift.

- Terminal-Bench 2.1: 88.8% (single) → 91.9% (ultra)
- 3-4x token cost but faster wall-clock time for parallelizable tasks
- Available in Codex and ChatGPT Work, beta in Responses API

**Why this matters:** Validates the sub-agent pattern we should build into SpielOS's graph runtime — an orchestrator node that fans out to multiple child agents with their own roles/skills and merges results.

#### Programmatic Tool Calling (PTC)

Sol can write and execute JavaScript in an isolated V8 sandbox to orchestrate multiple tool calls in code — looping, branching, aggregating — instead of one tool call per turn.

- Zero Data Retention compatible
- Moves orchestration logic from app code into the model
- Dramatically reduces round-trips for data-heavy workflows

**Why this matters:** This is the end state for our tool calling. Instead of one tool_call → wait → one tool_result → one tool_call, the model writes orchestrator code that fans out, filters, and returns only the useful state.

#### Persisted Reasoning

New `reasoning.context` parameter:
- `all_turns`: Carries reasoning artifacts across turns using `previous_response_id`
- `current_turn`: Resets reasoning per turn (default)
- Improves multi-turn quality and cache efficiency

**Why this matters:** We should store reasoning summaries/checkpoints that carry forward across turns instead of re-sending full message history.

#### Token Efficiency

- 54% more token-efficient on coding tasks vs GPT-5.5
- 15k tokens per Intelligence Index task vs 16k for GPT-5.5
- Cache writes: 1.25x input rate, 30-min TTL, 90% read discount

### Architectural Patterns from GPT-5.6 Ecosystem

The industry pattern for long-horizon agents (based on Lushbinary, Developers Digest, and OpenAI's own guides):

```
Planner (Sol) → Executor (Terra/Luna) → Verifier (Sol)
         ↑                                      │
         └──────────── feedback loop ────────────┘
```

- Planner: task decomposition, replanning (needs frontier reasoning)
- Executor: scoped steps, most tool calls (can use cheaper tier)
- Verifier: deterministic checks + critic pass
- Memory store: external, not in context

---

## 7. Memory Types Taxonomy

Based on cognitive science (Tulving 1972, Squire 2004, CoALA 2023) and the 2026 agent memory literature.

### The 7 Memory Types

| Type | What It Is | Lifespan | Storage | SpielOS Status |
|------|-----------|----------|---------|----------------|
| **Working** | Live context window/scratchpad | Single turn | LLM context | Chat only, no compaction |
| **Episodic** | Past interaction traces, event histories | Session to lifetime | Append-only event log | `run_events` table (append-only, unused for retrieval) |
| **Semantic** | De-contextualized facts & knowledge | Long-lived | Vector store / KG | None |
| **Procedural** | Learned how-to / skills / routines | Long-lived | Versioned policy store | File-backed roles/skills (designer-set, not learned) |
| **Retrieval** | RAG over external documents | Query-time | Vector index | File-backed knowledge (manual, no auto-retrieval) |
| **Parametric** | Knowledge baked into model weights | Training-time | Model weights | The LLM itself |
| **Prospective** | Future planning / goals / intentions | Task lifetime | Task state | None |

### The 4-Tier Production Architecture (from Geodocs.dev/Agent Memory Pattern Spec)

| Tier | Lifetime | Storage | Typical Content |
|------|----------|---------|-----------------|
| Working | Single turn | LLM context | Current user message, retrieved chunks, scratchpad |
| Episodic | Session to lifetime | Append-only event log | "On 2026-05-01 the user asked about pricing" |
| Semantic | Long-lived | Key-value store + vector index | "User prefers metric units" |
| Procedural | Long-lived | Versioned policy/playbook store | "Always confirm before deleting" |

### Memory != RAG

Key distinction from the literature:
- **RAG** reads external documents at query time, then forgets. Stateless, read-only.
- **Memory** persists the agent's own state with a distinct write phase (extract → decide → store → retrieve).

### Memory Systems Landscape (2026)

| System | Approach |
|--------|----------|
| **MemGPT / Letta** | OS-analogy: core (in-context "memory blocks") / recall (searchable history) / archival (external DB). Agent moves data between tiers itself. |
| **Mem0** | Commercial memory layer. Two-phase: extraction (LLM distills facts) → update (match by vector, LLM picks ADD/UPDATE/DELETE/NOOP). |
| **Zep / Graphiti** | Temporal knowledge graph. Bi-temporal (when event occurred + when ingested). Conflicts invalidate stale edges rather than delete. |
| **LangGraph / LangMem** | Thread-scoped checkpointers (working) + cross-thread store with namespaces + optional semantic search. |
| **Anthropic (first-party)** | `/memories` directory, persistent NOTES.md-style file across sessions. Public beta. |
| **AgeMem** (ACL 2026) | Unified LTM + STM management as tool-based actions. Three-stage progressive RL. Step-wise GRPO for sparse rewards. |
| **PlugMem** (arXiv 2603.03296) | Task-agnostic plugin. Standardizes episodic, extracts propositional (semantic) + prescriptive (procedural) knowledge graphs with provenance. |
| **AdMem** (arXiv 2606.06787) | Multi-agent: actor, memory, critic. Reward-based evaluation, merging, pruning. Auto-generated memory + reward annotation. |

---

## 8. Current Execution Architecture

### Graph Topology

```
Single flat StateGraph per run
├── Workflow: DAG from saved nodes + edges
│   ├── Fan-out: multiple outgoing edges from one node
│   ├── Join: multiple incoming edges to one node
│   └── Eval gates: retry loop back to source node
├── Single-node: role, skill, or eval target
│   └── One node, START -> node -> END
└── Plain chat: no graph, direct provider streaming
```

Current: `packages/graph/src/index.ts` — 1580 lines, uses `@langchain/langgraph`.

### Node Execution Flow

```
For each node:
  1. Skip if completed (unless retry)
  2. Phase 1: Execute tool skills sequentially
     - human_input: pause, emit frame, wait for resume
     - eval: run rubric rules, score, check threshold
     - knowledge_search: search file bodies
     - http: read-only fetch (write requires confirmed adapter)
     - mcp_call: intentionally rejected (no server adapter)
  3. Phase 2: Execute llm_call skills sequentially
     - Pure text processing, no tools
  4. Emit events, yield state
```

### What's Missing

| Feature | Current State | Required For |
|---------|--------------|--------------|
| Sub-graphs | None | Multi-agent orchestration, nested workflows |
| Parallel node execution | LangGraph fan-out only | True concurrent branches |
| Conditional routing | Always takes `outgoing[0].target` | Dynamic workflow paths |
| SSE multiplexing | Single stream | Parallel node output |
| LangGraph native checkpointing | Custom JSONB blob | Durable persistence at scale |

---

## 9. Dependency Analysis: What Blocks What

```
            ┌─────────────────────────────────────┐
            │      PHASE 0: Foundations           │
            │  Auth (DONE)                        │
            │  Multi-tenancy (DONE)               │
            │  Token counting                     │
            │  Context items persistence          │
            └──────────────┬──────────────────────┘
                           │
                           ▼
            ┌─────────────────────────────────────┐
            │      PHASE 1: Context Management    │
            │  Basic compaction                   │
            │  Token-aware history loading        │
            └──────────────┬──────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
   ┌─────────────────┐ ┌──────────┐ ┌──────────────────┐
   │ PHASE 2: Memory │ │ PHASE 3a │ │ PHASE 3b:        │
   │                 │ │ Harness  │ │ Advanced Exec     │
   │ - Episodic      │ │ Creation │ │                   │
   │ - Semantic      │ │          │ │ - Tool calling    │
   │ - Vectors       │ │ - Tool   │ │   adapters        │
   │ - Retrieval     │ │   defs   │ │ - Parallel nodes  │
   │ - Retrieval     │ │ - HITL   │ │ - Sub-graphs      │
   └─────────────────┘ └──────────┘ └──────────────────┘
```

### Key Insight: Memory Needs Context Management First

**Memory without context budget = sand:**
1. You store episodic memories
2. You retrieve relevant ones at chat start
3. You inject them into system prompt
4. But you have no compaction → context overflows
5. Memories get truncated with the 20-msg hard cap
6. Context items vanish on refresh → no base state to build on

**Memory without persistence = vapor:**
1. You summarize a run into episodic memory
2. The user refreshes the page
3. Context items are gone
4. The episodic summary is never loaded because nothing triggered it

**Therefore: Layers 0-1 must precede Layer 2.**

### Sub-Graph Debate

**Question:** Do we need sub-graphs/sub-agents before memory?

**Answer:** No. They are independent concerns.

Sub-graphs add significant complexity — nested state isolation, child graph streaming, cross-graph error handling, parent-child communication. The current flat graph handles all current use cases. Sub-graphs are an execution optimization, not a memory prerequisite.

When we do build sub-graphs:
- We need `StateGraph.addNode()` to accept a compiled child graph
- `RunStateAnnotation` needs scoping/isolation for child state
- SSE needs multiplexing (per-node or per-graph streams)
- Need termination propagation (child fails → parent fails)

---

## 10. Implementation Roadmap

### Phase 0: Foundations (1-2 weeks)

| # | Task | Effort | Dependencies | Impact |
|---|------|--------|-------------|--------|
| 0.1 | **Token counting** — utility that counts tokens per message + total across history. Can use `tiktoken` for OpenAI, Anthropic's tokenizer, or approximation. | 2-3 days | None | Context budget awareness |
| 0.2 | **Context items persistence** — save selected context items to `runs.inputs` JSONB per chat. Restore on chat load in `use-chat-store.ts`. | 1-2 days | Auth (DONE) | Fixes immediate UX pain of lost selection |
| 0.3 | **Token-aware history loading** — replace hard 20-msg slice with token-aware logic that loads messages up to budget. | 1-2 days | 0.1 | Smarter context utilization |

### Phase 1: Context Management (1-2 weeks)

| # | Task | Effort | Dependencies | Impact |
|---|------|--------|-------------|--------|
| 1.1 | **Basic compaction** — when context crosses threshold (e.g., 80% of model max), summarize older turns into a structured recap. Inject as system message before current turn. | 3-5 days | 0.1 | Prevents context overflow |
| 1.2 | **Compaction trigger** — auto-trigger at threshold. Also expose as API for manual compaction. | 1-2 days | 1.1 | Developer control |
| 1.3 | **Context budget tracking** — track `used / max` tokens in run state. Expose in UI (status indicator). | 2-3 days | 0.1, 1.1 | Visibility into consumption |

### Phase 2: Memory (2-3 weeks)

| # | Task | Effort | Dependencies | Impact |
|---|------|--------|-------------|--------|
| 2.1 | **Episodic memory table** — new DB table `episodes` (org_id, run_id, summary, outcomes[], artifacts[], tags[], embedding VECTOR, created_at). Extract from completed runs. | 3-5 days | 1.1 | What happened in past |
| 2.2 | **Semantic memory extraction** — after each message/run, distill facts (user preferences, decisions, rejections). Store as key-value with embeddings. | 3-5 days | 2.1 | Who the user is |
| 2.3 | **Vector embeddings** — add pgvector extension. Embed episodes + semantic facts + chat messages at write time. | 2-3 days | 2.1 | Semantic search |
| 2.4 | **Memory retrieval at chat start** — search top-K relevant past episodes/facts. Inject into system prompt. | 2-3 days | 2.2, 2.3 | Cross-session recall |
| 2.5 | **Consolidation job** — background cron that extracts raw messages into structured memory. Idempotent, dedup by hash. | 2-3 days | 2.1, 2.2 | Keeps memory fresh |

### Phase 3a: Harness Creation via Chat (1-2 weeks)

| # | Task | Effort | Dependencies | Impact |
|---|------|--------|-------------|--------|
| 3a.1 | **Tool definitions** — add `tools` parameter to `ChatRequest` and `ChatAdapter`. Implement in OpenAI adapter (Anthropic has tools too). | 2-3 days | None | Enables all tool calling |
| 3a.2 | **CRUD tools for harness** — define tool schemas: `create_role`, `create_skill`, `create_workflow`, `create_eval`, `edit_file`, `delete_file`. Wire to existing file CRUD APIs. | 3-5 days | 3a.1 | Chat creates items |
| 3a.3 | **Human-in-the-loop for destructive ops** — confirmation dialog before apply. Diff preview for edits. | 2-3 days | 3a.2 | Safety guardrail |
| 3a.4 | **Multi-turn tool orchestration** — enable multiple tool calls per LLM turn. Track tool call order. | 2-3 days | 3a.1 | Parallel tool use |

### Phase 3b: Advanced Execution (parallel to 3a, 2-3 weeks)

| # | Task | Effort | Dependencies | Impact |
|---|------|--------|-------------|--------|
| 3b.1 | **Conditional routing** — router inspects node output to pick branch. `if/else` conditions in workflow edges. | 2-3 days | None | Dynamic workflows |
| 3b.2 | **Explicit parallel node execution** — `Promise.all` for fan-out branches. SSE multiplexing per node. | 3-5 days | None | True concurrent execution |
| 3b.3 | **Sub-graph support** — `graph.addNode()` accepts compiled child graph. Nested `RunStateAnnotation` with prefix scoping. | 1-2 weeks | 3b.2 | Complex orchestration |
| 3b.4 | **Sub-agent delegation** — new skill kind `agent_call` that constructs and runs a nested graph with its own roles/skills/model. | 3-5 days | 3b.3 | Hierarchical agents |

### Phase 4: Frontier Features (future, 3-4 weeks)

| # | Task | Effort | Dependencies | Impact |
|---|------|--------|-------------|--------|
| 4.1 | **Indexed experience memory (Memex-style)** — compact working state + full-fidelity archived artifacts under stable indices. Agent dereferences on demand. | 1-2 weeks | 2.3, 2.4 | Less lossy memory |
| 4.2 | **Programmatic tool calling** — model-written JS in isolated sandbox for tool orchestration (PTC pattern from GPT-5.6). | 2-3 weeks | 3a.4 | Multi-tool orchestration |
| 4.3 | **Lossless context management** — hierarchical summary DAG with lossless pointers (LCM). | 2-3 weeks | 1.1, 2.1 | Zero information loss |
| 4.4 | **Model tier routing** — route simple tasks to cheap models (Luna-class), hard reasoning to Sol-class. Dynamic based on task complexity. | 1-2 weeks | 0.1 | Cost optimization |
| 4.5 | **Ultra multi-agent orchestration** — orchestrator node spawns N parallel sub-agents that communicate mid-task (GPT-5.6 Ultra pattern). | 2-3 weeks | 3b.4 | Frontier capability |

---

## 11. Key Decisions & Rationale

### Decision 1: Build context management before memory

**Made:** July 2026
**Why:** Memory needs a context budget to work. Without token counting and compaction, you store memories but can't reliably inject them without overflowing. Dependencies flow down, not sideways.
**Alternative considered:** Build memory directly using external vector store (would work without compaction but memories would fight with conversation history for context space).

### Decision 2: Sub-graphs are NOT a memory prerequisite

**Made:** July 2026
**Why:** Memory operates on data above the graph layer (messages, episodes, facts). Sub-graphs are an execution optimization. They're independent concerns.
**Alternative considered:** Build sub-graphs first as foundation for everything. Rejected because it creates unnecessary complexity before proving value.

### Decision 3: Prefer lossy compaction first, lossless later

**Made:** July 2026
**Why:** Lossy compaction (summarization) is simple, works today, and prevents context overflow. Lossless approaches (CWL, LCM, Memex) require structured annotated episodes, dependency tracking, and index management — too much for first pass.
**Trade-off:** Lossy compaction loses verbatim text. Not suitable for legal/audit trails. Acceptable for marketing content workflows (SpielOS's primary domain).

### Decision 4: pgvector over external vector store

**Made:** July 2026 (de facto — Supabase already hosts Postgres)
**Why:** One less dependency. pgvector works well enough for production memory retrieval. External (Pinecone, Weaviate) adds operational complexity.
**Revisit if:** pgvector performance degrades at scale (>1M vectors) or we need hybrid search with full-text + vector scoring.

### Decision 5: Tool calling adapters before harness creation

**Made:** July 2026
**Why:** Tool calling (function calling) is the foundation for both harness creation and programmatic tool orchestration. Building it once enables both Phase 3a and Phase 4.2.
**Implementation:** Add `tools?: ToolDef[]` to `ChatRequest`, `ChatAdapter.chat()`, and `ChatAdapter.stream()`. OpenAI adapter sends as `tools` parameter. Anthropic adapter sends as `tools` parameter. Streaming adapters need to handle delta tool calls.

### Decision 6: Hardcoded demo org → better-auth migration completed

**Made:** Before July 2026 (commit 52037c8)
**Why:** Production readiness. Multi-tenancy at DB level was structural. Auth closes the loop.
**Implementation:** `better-auth` with Google OAuth, auto-provisioning of default org on user creation, session resolution via `getOrg()`, role enforcement via `requireRole()`.

### Decision 7: Keep single flat StateGraph for now

**Made:** July 2026
**Why:** The flat graph handles all current use cases (DAG workflows, fan-out/join, eval retry, human checkpoints). Sub-graphs are Phase 3b because they add significant complexity for marginal gain until we need true hierarchical orchestration.

### Decision 8: Buffer API integration exists but is not memory-related

**Made:** July 2026
**Why:** Buffer MCP tools (`buffer_buffer_api_help`, `buffer_use_buffer_api`) are available for content publishing workflows. They're independent of the memory architecture — Buffer is an execution target, not a memory store.

---

## 12. Files Referenced

### Core App Files

| File | Purpose |
|------|---------|
| `apps/web/lib/server.ts` | Org resolution, session auth, role enforcement |
| `apps/web/lib/auth.ts` | better-auth configuration, Google OAuth, auto-provisioning |
| `apps/web/lib/auth-client.ts` | Client-side auth client |
| `apps/web/lib/auth-helpers.ts` | `createDefaultOrgForUser` hook |
| `apps/web/lib/execution-service.ts` | Run resolution, harness loading, director prompt |
| `apps/web/lib/chat-adapter.ts` | Client chat streaming, context item mapping, `.find()` for executable target |
| `apps/web/lib/run-context.tsx` | Ephemeral `contextItems` state (`useState<ContextItem[]>([])`) |
| `apps/web/lib/run-events.ts` | `compactRunEvents()` deduplication for UI display |
| `apps/web/lib/use-chat-store.ts` | Client-side chat store |
| `apps/web/lib/use-domain-store.ts` | Domain store with domain logic |
| `apps/web/components/chat/context-picker.tsx` | Conflict rules for harness item selection |
| `apps/web/components/chat/chat-thread.tsx` | Chat composer, mention dropdown, context chips |
| `apps/web/components/chat/context-chips.tsx` | Renders attached context items as chips |
| `apps/web/app/api/runs/execute/route.ts` | SSE stream, checkpoint capture, run persistence |
| `apps/web/app/api/runs/[id]/reply/route.ts` | Human-input resume, checkpoint reload |
| `apps/web/app/api/chats/route.ts` | Chat CRUD |
| `apps/web/app/api/chats/[id]/messages/route.ts` | Message append |

### Package Files

| File | Purpose |
|------|---------|
| `packages/graph/src/index.ts` | LangGraph runtime, node executors, checkpointing, buildGraph |
| `packages/providers/src/openai.ts` | OpenAI adapter (NO tools parameter) |
| `packages/providers/src/anthropic.ts` | Anthropic adapter |
| `packages/providers/src/types.ts` | `ChatRequest`, `ChatAdapter` interface |
| `packages/providers/src/registry.ts` | `streamChat`, `adapterForProvider` |
| `packages/core/src/index.ts` | Shared types, SSE frame schema |
| `packages/db/src/index.ts` | DB functions (createRun, listHarnessFiles, etc.) |
| `packages/db/migrations/0001_init.sql` | Foundation schema |
| `packages/db/migrations/0002_tenant_integrity.sql` | Multi-tenant composite FKs |

### Docs & Config

| File | Purpose |
|------|---------|
| `docs/architecture.md` | System architecture overview |
| `docs/langgraph-runtime.md` | Graph runtime semantics |
| `docs/data-model.md` | Database schema documentation |
| `docs/harness-model.md` | Harness domain model |
| `docs/production-readiness-audit.md` | Production readiness tracking |
| `PLAN.md` | Production readiness plan (P0 items) |
| `POSITIONING.md` | Product positioning |
| `AGENTS.md` | Project rules and conventions |
| `supabase/seed/system/orchestrator-prompt.md` | System prompt (restricts tool invention) |

---

## 13. Research Sources

### Papers

| Title | Venue | Key Finding |
|-------|-------|-------------|
| [CompactionRL: RL with Context Compaction for Long-Horizon Agents](https://arxiv.org/html/2607.05378v1) | arXiv 2026 | Joint optimization of execution + summarization via RL. Deployed in GLM-5.2 training pipeline. |
| [Memory as Action: Autonomous Context Curation (MemAct)](https://aclanthology.org/2026.findings-acl.956.pdf) | ACL 2026 Findings | Memory management as learnable policy actions. 14B matches 235B with 51% less context. |
| [Beyond Compaction: Structured Context Eviction (CWL)](https://arxiv.org/html/2606.11213) | arXiv 2026 | Typed, dependency-linked episodes with deterministic eviction. 80M tokens with zero degradation. |
| [Memex(RL): Indexed Experience Memory](https://arxiv.org/pdf/2603.04257) | arXiv 2026 | Compact indexed summary + full-fidelity archive. Less lossy than summary-only. |
| [LCM: Lossless Context Management](https://arxiv.org/abs/2605.04050) | arXiv 2026 | Hierarchical summary DAG with lossless pointers. Beats Claude Code on OOLONG. |
| [Parallel Context Compaction](https://arxiv.org/html/2605.23296v1) | arXiv 2026 | Block-based parallel summarization with operator-controlled volume. Reduces wall time. |
| [Self-Compacting Language Model Agents](https://arxiv.org/pdf/2606.23525) | arXiv 2026 | Agent decides when to compact via lightweight rubric. No fine-tuning. |
| [SUPO: Beyond the Context Window](https://aclanthology.org/2026.acl-long.966/) | ACL 2026 | Joint tool-use + summarization training. |
| [Active Context Compression (Focus)](https://arxiv.org/abs/2601.07190) | arXiv 2026 | Agent-centric sawtooth compression. 22.7% token reduction at identical accuracy. |
| [STAE: Semantic-Temporal Aware Eviction](https://openreview.net/pdf/7a633668675afc936bcbb39004813bccca2dfca4.pdf) | OpenReview | Embedding-based redundancy detection. Local STAE outperforms global. |
| [IndexMem: Learned KV-Cache Eviction](https://arxiv.org/html/2605.25475v1) | arXiv 2026 | Learnable indexer + latent memory module for evicted tokens. Up to 25 points improvement. |
| [IntentKV: Intention-aware KV Cache](https://aclanthology.org/2026.acl-long.1250.pdf) | ACL 2026 | Intention token identification via JSD. 128K → 2K with maintained performance. |
| [Agentic Memory (AgeMem)](https://aclanthology.org/2026.acl-long.981/) | ACL 2026 | Unified LTM+STM as tool-based actions. Three-stage progressive RL. |
| [PlugMem: Task-Agnostic Plugin Memory](https://arxiv.org/pdf/2603.03296) | arXiv 2026 | Standardizes episodic into propositional+prescriptive knowledge graphs. |
| [AdMem: Advanced Memory for Task-solving Agents](https://arxiv.org/html/2606.06787) | arXiv 2026 | Multi-agent actor/memory/critic with reward-based eviction. |

### Sources & Benchmarks

| Source | Type | Key Insight |
|--------|------|-------------|
| [Claude Platform Docs — Context Windows](https://platform.claude.com/docs/en/build-with-claude/context-windows) | Official docs | Server-side compaction at ~85%. `/v1/messages/compact` endpoint. Context awareness. |
| [OpenAI — GPT-5.6 Sol Model](https://developers.openai.com/api/docs/models/gpt-5.6-sol) | Official docs | 1.05M window, 128K output, $5/$30. Programmatic tool calling. Ultra multi-agent. |
| [OpenAI — Model Guidance](https://developers.openai.com/api/docs/guides/latest-model) | Official docs | Persisted reasoning with `reasoning.context`. Cache breakpoints. Multi-agent beta. |
| [OpenAI — Previewing GPT-5.6 Sol](https://openai.com/index/previewing-gpt-5-6-sol/) | Blog | Coding agent index #1. Ultra mode 91.9% on Terminal-Bench. |
| [GPT-5.6 System Card](https://deploymentsafety.openai.com/gpt-5-6) | Safety report | CoT controllability higher than GPT-5.5. Misalignment risk from over-persistence. |
| [TechCrunch — OpenAI launches GPT-5.6](https://techcrunch.com/2026/07/09/openai-launches-its-new-family-of-models-with-gpt-5-6/) | News | Three-tier family. $5/$30 for Sol. 54% token efficiency gain. |
| [Artificial Analysis — GPT-5.6 benchmarks](https://artificialanalysis.ai/articles/gpt-5-6-has-landed) | Independent | Sol scores 80 on Coding Agent Index. Per-task cost: Sol $1.04, Fable 5 ~$3. |
| [Lushbinary — Build Long-Horizon Agents with Sol](https://lushbinary.com/blog/build-long-horizon-ai-agents-gpt-5-6-sol-guide/) | Guide | Planner-executor-verifier architecture. Tier routing. External memory. |
| [Developers Digest — GPT-5.6 Developer's Guide](https://www.developersdigest.tech/blog/gpt-5-6-sol-terra-luna-developer-guide) | Guide | Multi-agent beta details. Cache breakpoints. Tool calling. |
| [n8n — AI Agent Memory Guide](https://blog.n8n.io/ai-agent-memory/) | Guide | 7 memory types. MemGPT, Mem0, Zep comparison. Pragmatic "most agents need only working + thin semantic." |
| [datarekha — Agent Memory](https://datarekha.com/agentic-ai/agent-memory/) | Guide | 4 types by lifespan. Working memory = checkpointed thread state. Memory != RAG. |
| [Geodocs.dev — Agent Memory Pattern Spec](https://geodocs.dev/ai-agents/agent-memory-pattern-spec) | Spec | 4-tier production architecture. Consolidation, retrieval scoring, eviction, PII redaction rules. |
| [MarkTechPost — 7 Types of Agent Memory](https://www.marktechpost.com/2026/06/21/the-7-types-of-agent-memory-a-technical-guide-for-ai-engineers/) | Guide | Working, semantic, episodic, procedural, retrieval, parametric, prospective. |

---

*Document generated July 2026. Captures the full conversation history, research survey, architectural debates, and implementation roadmap for SpielOS harness memory and context management.*
