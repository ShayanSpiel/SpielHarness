# Memory System — Plan & Infrastructure Analysis

*Generated 2026-07-19 from design session*

---

## 1. Session Context

We audited the `/strategy` page's Memory tab and the entire learned-memory pipeline. The Memory tab itself is a fully functional CRUD workspace (sidebar + editor + stats), and the memory system has real backend/database backing — but we discovered critical disconnections and gaps.

---

## 2. Current Infrastructure

### 2.1 Two Separate Systems

SpielOS has two distinct memory-related subsystems that must not be conflated:

| Dimension | Context Management (Long-Horizon) | Learned Memory |
|---|---|---|
| Scope | Within-session | Cross-session |
| What it does | Manages context window: trim, summarize, extract goals/decisions/constraints | Stores durable facts across sessions |
| Storage | `ChatPinnedState` in run state + checkpoints | `files` table with `metadata.memoryRecord: true` |
| Comparable to | MemGPT's FIFO queue + LangGraph checkpointer + Claude Code's Session Memory | Claude Code's Auto Memory + MemGPT's Archival Storage |
| **Our status** | ✅ Already frontier-level | ❌ Needs significant work |

### 2.2 Context Management (Already Strong)

- **`assembleLongHorizonContext()`** (`packages/providers/src/long-horizon.ts`) — Per-turn state extraction + compaction ladder
- **`extractStateOperations()`** (`packages/providers/src/state-extract.ts`) — Regex heuristic → LLM structured extraction of typed operations (`set_goal`, `add_decision`, `supersede_decision`, `add_constraint`, `add_open_work`, `complete_work`)
- **`reduceState()`** — Deterministic reducer with authority boundaries (user/workflow-authored items cannot be superseded by model proposals)
- **Compaction ladder** (`packages/providers/src/compaction-ladder.ts`) — 6 escalating passes (45% → 25% → 10% → 5% message retention) with milestone summaries
- **Goal / Budget / Progress / Verification** — Full typed schemas with running counters, deadlines, and token budgets
- **Atomic checkpointing** — Postgres transaction with `SELECT ... FOR UPDATE` serialization
- **Works fine for**: `streamRun` (workflow/role/skill/eval) and `streamChatRun` (plain chat)

**Does NOT work for**: `streamDirectorRun` (the deep agents Director runtime)

### 2.3 Learned Memory (Needs Work)

- **Storage**: `files` table with `metadata.memoryRecord: true`, `fileType: "knowledge"`
- **Lifecycle**: `proposed` → (user approves) → `approved` → (retrieved) or `superseded` / `forgotten`
- **Retrieval**: Keyword-only matching with pin boost, top 8 results, injected into system prompt
- **Proposal**: Via `memory.propose` skill (kind: `memory_write`) or manual CRUD via Memory tab / `/api/memory`
- **Scope isolation**: `workspace` / `user` / `role` / `workflow` scopes
- **API**: Full CRUD at `/api/memory` with dedup, conflict detection, supersession

---

## 3. Bugs Found

### Bug 1: `executeSkill` is a stub (P0)

**File**: `apps/web/lib/director-tools.ts:148-153`

```typescript
executeSkill: async ({ skillId, input }) => {
  // ...
  return JSON.stringify({ status: "delegated", skillId, input });
  // ^ NEVER ACTUALLY INVOKES THE SKILL
}
```

The Director mode creates `execute_skill_*` tools for every active skill (including `memory.propose`), but when the deep agent calls them, `executeSkill` just returns `{ status: "delegated" }`. No skill is actually run. Same for `executeEval` (line 155-161).

**Impact**: The Director can never execute any skill, including memory proposal, workflow execution, or eval scoring.

### Bug 2: Director doesn't inject memories into system prompt (P0)

**File**: `packages/graph/src/index.ts:2880+` (`streamDirectorRun`)

`streamChatRun` (line 2638-2640) and `streamRun` (line 689) both inject `req.memories` into the system prompt as "Retrieved learned memory". `streamDirectorRun` never does — the deep agent has zero awareness of approved memories.

### Bug 3: Director doesn't emit `memory_read` events (P1)

`streamRun` and `streamChatRun` emit `{ category: "memory_read" }` events when memories are retrieved. The Director emits nothing.

### Bug 4: Plain chat can't propose memories (P2)

Plain chat (`streamChatRun`) has no skill catalog loaded. The `memory.propose` skill is simply unavailable. Only workflow/role/skill runs have skills.

### Bug 5: No seed memory data (P2)

No seed records with `memoryRecord: true` exist. The first load of the Memory tab is always empty, making it unclear whether the system works at all.

### Bug 6: Context management not wired into Director (P1)

The long-horizon context assembly, state extraction, compaction ladder, goal/budget tracking — none of these run in Director mode. The Director operates as an isolated `createDeepAgent` instance with only its own LangGraph checkpointer.

---

## 4. Frontier Comparison

### 4.1 Systems Studied

| System | Key Innovation | Architecture |
|---|---|---|
| **Claude Code** (Anthropic) | 7-layer memory hierarchy, Auto Dream (background 4-phase consolidation), grep-over-RAG | CLAUDE.md → Auto Memory → Session Memory → Dreams → Agent Memory |
| **LangGraph** (LangChain) | Checkpointer (thread) + Store (cross-thread), pgvector optional | Namespaced key-value store with semantic search |
| **MemGPT / Letta** | OS-inspired hierarchy (RAM → Disk), self-directed memory editing, memory blocks | Main context (system + working + FIFO) → Archival + Recall storage |
| **SpielOS (us)** | File-backed, typed state operations, deterministic reducer | Context management = frontier; Learned memory = behind |

### 4.2 Learned Memory Gap Analysis

| Capability | Claude Code | LangGraph Store | MemGPT/Letta | SpielOS (us) |
|---|---|---|---|---|
| **Retrieval** | Index-based (grep + LLM) | Vector/keyword optional | Vector semantic | **Keyword only** |
| **Self-directed by agent** | Agent writes/rewrites memories | store.put/search from any node | memory_insert/replace/rethink | **Reactive tool calls only** |
| **Background consolidation** | Auto Dream (4-phase) | ❌ | Sleep-time compute | **❌ None** |
| **Auto-extraction from transcripts** | `extractMemories` per turn | ❌ | ❌ | **❌ None** |
| **Memory pressure** | Session Memory → compaction | trim_messages | FIFO queue + pressure warnings | **Context management only (not memory)** |
| **Semantic search** | Grep-over-RAG (deliberate) | pgvector optional | Vector DB | **❌ Keyword only** |
| **Per-agent isolation** | Agent memory dirs | Namespace tuples | Per-agent blocks | **Scope field** |
| **Session transcript mining** | Dream Phase 2 (grep sessions) | ❌ | recall_storage.search | **❌ None** |

### 4.3 Key Arguments from Session

1. **Context management ≠ Learned memory** — Our compaction/state-extraction/milestone system is genuinely frontier-level. But learned memory (cross-session durable facts) is a separate system with separate deficiencies.

2. **Keyword-only retrieval is a hard ceiling** — No amount of UI polish fixes the fundamental limitation that "pizza toppings" won't match "food preferences." Vector/semantic search is table stakes for frontier memory.

3. **Background consolidation is the killer feature** — Claude Code's Auto Dream (4-phase: Orient → Gather Signal → Consolidate → Prune & Index) is what separates toy memory from production memory. Without it, memories accumulate duplicates, contradictions, and stale entries forever.

4. **Self-directed memory is the philosophical shift** — MemGPT's core insight: the agent should manage its own memory, not just respond to tool calls. This requires explicit system prompt instructions about the memory hierarchy and tools for the agent to read/write/reorganize its own memory.

5. **Director gap is the immediate priority** — The most powerful runtime (deep agents) has zero access to any of these systems.

---

## 5. Implementation Plan (Phased)

### Phase 1: Fix the Pipeline (Current Sprint)

**Goal**: Make memory work end-to-end for all runtimes, including Director.

#### 1.1 Fix `executeSkill` stub
- **File**: `apps/web/lib/director-tools.ts`
- **What**: Replace the stub with actual `runChildWorkflow()` call (or direct skill executor) so skills like `memory.propose` actually execute.
- **Why**: Director can never propose memories or run any skill without this.
- **Depends on**: Nothing.

#### 1.2 Wire memories into Director system prompt
- **File**: `packages/graph/src/index.ts` (`streamDirectorRun`)
- **What**: Inject `req.memories` into the deep agent's context assembly, same pattern as `streamChatRun` does (line 2638-2640).
- **Why**: Director has zero awareness of approved memories.
- **Depends on**: Nothing.

#### 1.3 Wire context management into Director
- **File**: `packages/graph/src/index.ts` (`streamDirectorRun`) + `packages/providers/src/long-horizon.ts`
- **What**: Call `assembleLongHorizonContext()` before invoking the deep agent, so state extraction, compaction, goal/budget tracking work in Director mode.
- **Files affected**: `streamDirectorRun` invocation site, `director/compile.ts` system prompt builder.
- **Depends on**: 1.2

#### 1.4 Add `memory_read` events to Director
- **File**: `packages/graph/src/index.ts` (`streamDirectorRun`)
- **What**: Emit `{ category: "memory_read" }` SSE events when memories are retrieved, matching the pattern in `streamChatRun` and `streamRun`.
- **Depends on**: 1.2

#### 1.5 Verify with seed data
- **File**: `supabase/seed/` (new seed file)
- **What**: Add at least 2-3 seed memory records (`memoryRecord: true`, `memoryStatus: "approved"`) so the Memory tab is non-empty on first load.
- **Why**: Users and developers need to see the system working immediately.
- **Depends on**: Nothing (seeding is independent).

#### 1.6 Add automated test for memory flow
- **File**: `tests/` (new test file)
- **What**: Test `memoryProposalAction` → create → approve → retrieve → inject → emit memory_read event. End-to-end.
- **Depends on**: 1.1, 1.2

### Phase 2: 3D Memory Constellation (Next Sprint)

**Goal**: Replace the utilitarian Memory tab stats bar with an interactive, beautiful visualization.

#### 2.1 Add Three.js / react-force-graph-3d dependency
- Add `react-force-graph-3d` (or custom Three.js via `@react-three/fiber`) to `apps/web/package.json`
- Design system: add animation tokens if needed

#### 2.2 Build Memory Constellation component
- Interactive 3D force-directed graph
- Nodes = memories, sized by `confidence`, colored by `status`
- Edges = shared scope, supersession chain, conflicts
- Click node → select memory in editor sidebar below
- Ambient auto-rotation when idle
- Bloom/glow post-processing (UnrealBloomPass)
- Respects `prefers-reduced-motion`
- Only animates during active progress (per interaction design mandate)

#### 2.3 Replace stats bar with constellation
- Layout: graph occupies upper portion of main content area, editor form below
- Stats (approved/proposed/pinned/conflicts) shown as subtle overlays on the graph

#### 2.4 Add dream-status indicator
- Small Canvas 2D particle widget in the Memory tab header
- Shows idle/active/dreaming states
- Idle: particles drift slowly
- Active (future): particles gravitate toward center with glow

### Phase 3: Frontier Upgrades (Next Milestone)

**Goal**: Bring learned memory to parity with frontier systems.

#### 3.1 Vector/semantic search
- Add `pgvector` extension to Supabase project
- Add embedding column to `files` table (or new `memory_embeddings` table)
- Generate embeddings on memory save (via provider API or local embedding model)
- Replace keyword scoring in `retrieveMemories()` with hybrid (vector + keyword) scoring
- Add `similarity` field to memory records

#### 3.2 Auto-extraction from transcripts
- New module: `packages/providers/src/memory-extract.ts`
- Fork a subagent after each run turn (fire-and-forget, non-blocking)
- Subagent reads recent messages, extracts candidate memories
- Proposes them via `memoryProposalAction` (creates as `proposed`)
- Modeled on Claude Code's `extractMemories`

#### 3.3 Self-directed memory tools
- Add `memory_read`, `memory_write`, `memory_search`, `memory_list` tools to the Director's tool catalog
- Instruct the deep agent in its system prompt about the memory hierarchy and when to use each tool
- Modeled on MemGPT's `archival_memory_insert/search` and `memory_replace/rethink`

#### 3.4 Background dreaming / consolidation
- Background cron or run trigger: `packages/providers/src/memory-dream.ts`
- 4-phase pipeline (Orient → Gather Signal → Consolidate → Prune & Index):
  1. **Orient**: Read all approved + proposed memories, build current state model
  2. **Gather Signal**: Scan recent session transcripts for new patterns, corrections, decisions
  3. **Consolidate**: Merge duplicates, resolve contradictions, convert relative dates, update confidence
  4. **Prune & Index**: Mark stale entries as `superseded`, surface new insights as `proposed`
- Uses a separate forked run (non-blocking, user-invisible)
- Trigger: time gate (24h idle) + session gate (N new sessions)
- Modeled on Claude Code's Auto Dream + Anthropic's Dreams API

#### 3.5 Session transcript mining
- Store run transcripts/searchably in the database (or files)
- Phase 2 of dreaming: grep session transcripts for specific patterns (corrections, saves, recurring themes)
- Modeled on Claude Code's Dream Phase 2: "grep, don't read whole files"

---

## 6. Architecture Diagram (Target State)

```
USER MESSAGE
     │
     ▼
assembleLongHorizonContext() ─── per-turn, all runtimes
     │
     ├── extractStateOperations() → reduceState()
     │       ├── goals / decisions / constraints / open work
     │       └── authority-gated reducer
     │
     ├── runCompactionLadder()
     │       └── 6 escalating passes → milestones
     │
     └── RETRIEVE MEMORIES (learned memory)
             ├── vector + keyword hybrid search
             ├── filter by scope + status === approved
             └── inject into system prompt
     │
     ▼
LLM STREAMS (streamRun / streamChatRun / streamDirectorRun)
     │
     ├── Can call memory_read / memory_write / memory_search tools
     ├── Can propose memories → memoryProposalAction
     └── Can self-direct memory management
     │
     ▼
POST-TURN (fire-and-forget)
     │
     ├── extractMemories() → fork subagent → propose candidates
     └── (future) autoDream() → background consolidation
     │
     ▼
MEMORY TAB (UI)
     │
     ├── 3D force-directed constellation
     ├── CRUD editor (approve / forget / remove / supersede)
     ├── Dream-status indicator
     └── Real-time updates via SSE
```

---

## 7. Key Decisions from Session

1. **Memory is NOT cosmetic** — It has real backend/database backing, but critical bugs block the pipeline. Fix bugs before building UI.

2. **Director wiring first** — Wire memory + context management into the Director runtime before any visualization work. The most powerful runtime must work.

3. **3D constellation after pipeline fix** — The 3D force-directed graph replaces the stats bar, not the editor. The functional CRUD remains.

4. **Keyword-only is a hard ceiling** — Vector search is required for frontier-level retrieval. This is Phase 3 but non-negotiable for parity.

5. **No auto-consolidation (yet)** — User chose "visualize only" for now. But background dreaming is documented as Phase 3 for future prioritization.

6. **Separate context management from learned memory** — They have different timelines and different technical approaches. Do not conflate them.

---

## 8. Files Referenced

| File | Role |
|---|---|
| `apps/web/components/memory-workspace.tsx` | Memory tab UI component (306 lines) |
| `apps/web/app/api/memory/route.ts` | Memory CRUD API (208 lines) |
| `apps/web/lib/execution-service.ts` | Memory proposal action + retrieval (lines 474-528, 822-851) |
| `apps/web/lib/director-tools.ts` | Director tool stubs (BROKEN: executeSkill no-op) |
| `apps/web/app/api/runs/execute/route.ts` | Execute route, branches to streamDirectorRun (line 328) |
| `packages/graph/src/index.ts` | Core graph runtime, streamDirectorRun (line 2880) |
| `packages/graph/src/director/compile.ts` | Director compilation, buildDirectorTools (line 116) |
| `packages/graph/src/director/events.ts` | Director stream event mapping |
| `packages/graph/src/director/checkpointer.ts` | Director Postgres checkpointer |
| `packages/providers/src/long-horizon.ts` | Context assembly (state extraction + compaction) |
| `packages/providers/src/state-extract.ts` | State operation extraction |
| `packages/providers/src/compaction-ladder.ts` | Multi-pass compaction |
| `packages/providers/src/compaction.ts` | Single compaction pass |
| `packages/providers/src/context.ts` | Legacy compaction |
| `packages/core/src/index.ts` | Types: MemoryRecord, ChatPinnedState, StateOperation, RunGoal, etc. |
| `supabase/seed/skills/memory-propose.md` | Seed memory proposal skill |
| `supabase/seed/harness-manifest.json` | Seed manifest registering memory.propose |
| `packages/db/src/index.ts` | listHarnessFiles, atomic checkpointer |
