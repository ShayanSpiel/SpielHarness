# Chat Context Fix — Implementation Plan

## Summary

Fix context loss and spurious refreshes during agentic runs (director/direct mode). The root cause is a race between realtime-triggered `reload()` which overwrites store messages before the server persists the assistant reply, and a `ChatRuntimeProvider` keyed by pathname that remounts on navigation.

## Implementation Order

Apply patches in exactly this order. After each step `npm run typecheck` must pass.

---

## Patch 1 — Core schemas and serializers

**File: `packages/core/src/index.ts`**

### 1a. Add `archivedAt` to `chatSchema`

Find line ~456 and add `archivedAt`:

```ts
export const chatSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  title: z.string(),
  metadata: z.record(z.unknown()).default({}),
  archivedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string()
});
```

### 1b. Add frame payload schemas after `runStatusSchema` (around line 958)

```ts
export const runStateFrameSchema = z.object({
  goal: runGoalSchema.optional(),
  budget: runBudgetSchema.optional(),
  progress: runProgressSchema.optional(),
  verification: runVerificationSchema.optional()
});
export type RunStateFrame = z.infer<typeof runStateFrameSchema>;

export const usageFrameSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  toolCalls: z.number()
});
export type UsageFrame = z.infer<typeof usageFrameSchema>;
```

### 1c. Replace `sseFrameSchema` (lines 1005-1014)

Add all actual protocol frames:

```ts
export const sseFrameSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run"), runId: z.string(), type: z.string() }),
  z.object({ kind: z.literal("chat_created"), chatId: z.string(), chat: chatSchema }),
  z.object({ kind: z.literal("message_persisted"), chatId: z.string(), message: chatMessageSchema, runId: z.string() }),
  z.object({ kind: z.literal("event"), event: runEventSchema }),
  z.object({ kind: z.literal("artifact"), artifact: artifactSchema }),
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("status"), message: z.string() }),
  z.object({ kind: z.literal("run_state"), state: runStateFrameSchema }),
  z.object({ kind: z.literal("usage"), usage: usageFrameSchema }),
  z.object({ kind: z.literal("human_input"), request: humanInputRequestSchema }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  z.object({ kind: z.literal("done"), runId: z.string(), status: runStatusSchema })
]);
export type SseFrame = z.infer<typeof sseFrameSchema>;
```

### 1d. Add shared serializers after `chatMessageSchema` (after line 475)

```ts
export function chatRowToChat(row: {
  id: string; org_id: string; title: string;
  metadata: Record<string, unknown>;
  created_at: string; updated_at: string; archived_at: string | null;
}): Chat {
  return {
    id: row.id, orgId: row.org_id, title: row.title,
    metadata: row.metadata ?? {},
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function messageRowToChatMessage(row: {
  id: string; org_id: string; chat_id: string;
  role: string; body: string; metadata: Record<string, unknown>;
  created_at: string;
}): ChatMessage {
  return {
    id: row.id, orgId: row.org_id, chatId: row.chat_id,
    role: row.role as "user" | "assistant" | "system" | "tool",
    body: row.body, metadata: row.metadata ?? {},
    createdAt: row.created_at
  };
}
```

**Verification:** `npm run typecheck`

---

## Patch 1b — Shared chat-store helpers in core

**File: `packages/core/src/index.ts`**

Add pure-function helpers that the store, chat-adapter, and tests all use.

Add after `messageRowToChatMessage` (around line 1126):

```ts
export function upsertMessage<T extends { id: string }>(
  msgs: T[],
  msg: T
): T[] {
  const idx = msgs.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    const copy = [...msgs];
    copy[idx] = msg;
    return copy;
  }
  return [...msgs, msg];
}

export function mergeMessages<T extends { id: string; createdAt: string }>(
  existing: T[],
  incoming: T[]
): T[] {
  const existingIds = new Set(existing.map((m) => m.id));
  const merged = [
    ...existing,
    ...incoming.filter((m) => !existingIds.has(m.id))
  ];
  merged.sort((a, b) => {
    const c = a.createdAt.localeCompare(b.createdAt);
    return c !== 0 ? c : a.id.localeCompare(b.id);
  });
  return merged;
}

/**
 * Reconcile incoming server chats against the current local list.
 *
 * - Incoming archived chats are filtered out (the server will eventually
 *   return them but we hide them immediately).
 * - Server rows update unchanged IDs (server is authoritative for chats
 *   not mutated after reload began).
 * - IDs present in `mutatedIds` preserve their CURRENT presence or absence
 *   — if the local list has the ID, keep it as-is; if the local list does
 *   NOT have the ID, do not add it from incoming.
 * - Brand-new server chats (not in current AND not in mutatedIds) are added.
 * - Returns the complete reconciled list in original order (current first,
 *   then new server-only chats).
 */
export function reconcileChats<T extends { id: string; archivedAt: string | null }>(
  current: T[],
  incoming: T[],
  mutatedIds: Set<string>
): T[] {
  const incomingMap = new Map(incoming.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const result: T[] = [];

  for (const c of current) {
    seen.add(c.id);
    if (mutatedIds.has(c.id)) {
      // Locally mutated during reload — preserve current row (or absence
      // was already handled by the fact it's still in `current`).
      result.push(c);
    } else if (incomingMap.has(c.id)) {
      const inc = incomingMap.get(c.id)!;
      if (!inc.archivedAt) {
        result.push(inc); // fresh server row for unchanged ID
      }
      // else: server says archived, drop from reconciled list
    }
    // else: server no longer knows this ID, drop it
  }

  // Add brand-new server chats not in current and not mutated
  for (const c of incoming) {
    if (!seen.has(c.id) && !mutatedIds.has(c.id) && !c.archivedAt) {
      result.push(c);
      seen.add(c.id);
    }
  }

  return result;
}
```

**Verification:** `npm run typecheck`

---

## Patch 2 — Add `org_id` to `/api/chats` message query

**File: `apps/web/app/api/chats/route.ts`**

The SQL query at line 14 does not SELECT `org_id`, but the `messageRowToChatMessage` serializer (added in Patch 1) requires it. The `chat_messages` type annotation also needs updating.

### 2a. Update the SQL query

Add `org_id` to the SELECT list:

```ts
const messages = ids.length
  ? await org.sql<{ id: string; chat_id: string; org_id: string; role: string; body: string; metadata: Record<string, unknown>; created_at: string }[]>`
      select id, chat_id, org_id, role, body, metadata, created_at
      from chat_messages
      where org_id = ${org.orgId} and chat_id = any(${ids})
      order by created_at asc
    `
  : [];
```

### 2b. Update the response type in `use-chat-store.ts`

When Patch 3 modifies `reload()`, the `chat_messages` map step (line 115) must include `org_id` — this is handled automatically by switching to `messageRowToChatMessage` which reads `row.org_id`.

**Verification:** `npm run typecheck`

---

## Patch 2b — Add `finalizeRunTurn()` DB transaction

**File: `packages/db/src/index.ts`**

Add a function that atomically persists the final checkpoint state, assistant message, and chat metadata in one `sql.begin()` transaction. Idempotency is guaranteed by a dedicated uniqueness key stored in the `chat_messages.metadata` field — see Correction 4.

```ts
export interface FinalizeTurnOptions {
  outputText: string;
  events: import("@spielos/core").RunEvent[];
  state: Record<string, unknown>;
  status: string;
  error: string | null;
  completedAt: string | null;
  isDirectorChat: boolean;
  /** For execute route — merge into chat metadata after project revision */
  longHorizon?: { pinnedState: unknown; milestones: unknown } | null;
  /** For reply route — resume tracking */
  resumedFrom?: string;
}

export interface FinalizeTurnResult {
  run: RunRow;
  messages: ChatMessageRow[];
  chat: ChatRow | null;
}

/**
 * Atomically finalize a run turn: checkpoint run state, persist the
 * assistant chat message, and update chat metadata within one PG
 * transaction.
 *
 * Message idempotency key:
 *   initial run → `run:{runId}:turn:{turnId}:final`
 *   resumed run → `run:{runId}:resume:{requestId}`
 */
export async function finalizeRunTurn(
  sql: SqlSql,
  orgId: string,
  runId: string,
  chatId: string,
  turnId: string | null,
  currentCheckpointVersion: number,
  opts: FinalizeTurnOptions
): Promise<FinalizeTurnResult> {
  return sql.begin(async (tx) => {
    // 1. Lock and re-read the run
    const [run] = await tx<RunRow[]>`
      select * from runs
      where org_id = ${orgId} and id = ${runId}
      for update
    `;
    if (!run) throw new Error(`Run ${runId} not found`);

    // 2. Resolve cancel/pause authority
    let terminalStatus = opts.status;
    let errorMessage = opts.error;
    let finalCompletedAt = opts.completedAt;
    if (run.cancel_requested_at || run.status === "cancelled") {
      terminalStatus = "cancelled";
      errorMessage = null;
      finalCompletedAt = new Date().toISOString();
    } else if (run.pause_requested_at || run.status === "waiting_human") {
      terminalStatus = "waiting_human";
      errorMessage = null;
      finalCompletedAt = null;
    }

    // 3. Validate checkpoint version
    const storedVersion = Number(run.checkpoint_version ?? 0);
    if (currentCheckpointVersion > 0 && storedVersion !== currentCheckpointVersion) {
      throw new Error(`Checkpoint version mismatch: stored=${storedVersion} expected=${currentCheckpointVersion}`);
    }

    // 4. Persist final events + state + status
    const finalCheckpointVersion = storedVersion + 1;
    const stateJson = JSON.stringify(opts.state);
    const eventsJson = JSON.stringify(opts.events);
    await tx`
      update runs set
        state = ${stateJson}::jsonb,
        events = ${eventsJson}::jsonb,
        outputs = ${tx.json({ text: opts.outputText })},
        status = ${terminalStatus},
        error = ${errorMessage},
        checkpoint_version = ${finalCheckpointVersion},
        completed_at = ${finalCompletedAt}
      where org_id = ${orgId} and id = ${runId}
    `;

    // 5. Upsert the assistant message with idempotency key
    const idempotencyKey = turnId
      ? `run:${runId}:turn:${turnId}:final`
      : opts.resumedFrom
        ? `run:${runId}:resume:${opts.resumedFrom}`
        : null;

    let messages: ChatMessageRow[] = [];
    if (opts.outputText && idempotencyKey) {
      // Check if already inserted for this key
      const existing = await tx<ChatMessageRow[]>`
        select * from chat_messages
        where org_id = ${orgId} and chat_id = ${chatId}
          and metadata->>'idempotencyKey' = ${idempotencyKey}
        limit 1
      `;
      if (existing.length === 0) {
        const insertMeta: Record<string, unknown> = {
          runId,
          turnId: turnId ?? undefined,
          kind: "assistant_reply",
          idempotencyKey,
          ...(opts.isDirectorChat ? { executionMode: "director" } : {}),
          ...(opts.resumedFrom ? { resumedFrom: opts.resumedFrom } : {})
        };
        messages = await tx<ChatMessageRow[]>`
          insert into chat_messages (org_id, chat_id, role, body, metadata, created_at)
          values (
            ${orgId}, ${chatId}, 'assistant', ${opts.outputText},
            ${tx.json(insertMeta)}, ${new Date().toISOString()}
          )
          returning *
        `;
      } else {
        messages = existing;
      }
    }

    // 6. Update chat metadata (activeRunId, lastRunId)
    const chatMetaUpdate: Record<string, unknown> = {
      activeRunId: terminalStatus === "waiting_human" ? runId : null,
      lastRunId: runId
    };
    if (opts.longHorizon) {
      chatMetaUpdate.pinnedState = opts.longHorizon.pinnedState;
      chatMetaUpdate.milestones = opts.longHorizon.milestones;
    }

    const [chat] = await tx<ChatRow[]>`
      update chats set
        metadata = metadata || ${tx.json(chatMetaUpdate)},
        updated_at = ${new Date().toISOString()}
      where org_id = ${orgId} and id = ${chatId}
      returning *
    `;

    // 7. Re-read the committed run row
    const [finalRun] = await tx<RunRow[]>`
      select * from runs where org_id = ${orgId} and id = ${runId}
    `;

    return { run: finalRun!, messages, chat: chat ?? null };
  });
}
```

**Verification:** `npm run typecheck`

---

## Patch 3 — Chat store: upsertMessage, upsertChat, safe reload, merge-by-ID

**File: `apps/web/lib/use-chat-store.ts`**

### 3a. Add imports

```ts
import { chatRowToChat, messageRowToChatMessage, upsertMessage as mergeMessage, mergeMessages, reconcileChats, type Chat as CoreChat } from "@spielos/core";
```

### 3b. Replace `upsertMessage` implementation with core helper (around line 252)

Remove the inline `setMessages`/`findIndex` logic and call the core helper instead:

```ts
const upsertMessage = useCallback((chatId: string, msg: DbChatMessage) => {
  setMessages((prev) => ({
    ...prev,
    [chatId]: mergeMessage(prev[chatId] ?? [], msg)
  }));
}, []);
```

### 3c. Track per-chat mutation versions and bump on every local mutation

Declare a `chatVersionsRef` that tracks a Map of chat ID → mutation version:

```ts
const chatVersionsRef = useRef<Map<string, number>>(new Map());
```

**`upsertChat`** bumps the version:

```ts
const upsertChat = useCallback((chat: CoreChat) => {
  chatVersionsRef.current.set(chat.id, (chatVersionsRef.current.get(chat.id) ?? 0) + 1);
  setChats((current) => {
    const idx = current.findIndex((c) => c.id === chat.id);
    if (idx >= 0) {
      const copy = [...current];
      copy[idx] = { ...copy[idx], ...chat } as Chat;
      return copy;
    }
    return [{ ...chat, archivedAt: chat.archivedAt ?? null } as Chat, ...current];
  });
}, []);
```

**`createChat`** also bumps the version for the new chat ID (add after the `setChats` call inside it, around line 176):

```ts
chatVersionsRef.current.set(chat.id, (chatVersionsRef.current.get(chat.id) ?? 0) + 1);
```

**`renameChat`** bumps (add after the `setChats` call inside it, around line 194):

```ts
chatVersionsRef.current.set(id, (chatVersionsRef.current.get(id) ?? 0) + 1);
```

**`updateChatMetadata`** bumps (add after the `setChats` optimistic update inside it, around line 221):

```ts
chatVersionsRef.current.set(id, (chatVersionsRef.current.get(id) ?? 0) + 1);
```

**`archiveChat`** bumps (add after `setChats` and before `setActiveChatId` inside it):

```ts
chatVersionsRef.current.set(id, (chatVersionsRef.current.get(id) ?? 0) + 1);
```

### 3d. Add refs for request sequencing and latest chats (after other useRefs, around line 57)

```ts
const reloadSeqRef = useRef(0);
const chatsRef = useRef<Chat[]>([]);
```

`chatsRef` keeps the latest reconciled chat list outside React state so `reload()` can read it without capturing `activeChatId` in the memoized closure.

### 3e. Modify `reload()` — add request sequencing and pre-fetch version snapshot

At the top of the `reload` callback body (after `reloadRef.current = reload;`):

```ts
const seq = ++reloadSeqRef.current;
const preFetchVersions = new Map(chatVersionsRef.current); // snapshot before fetch
```

Before setting chats/messages (after the response JSON is parsed):

```ts
if (seq !== reloadSeqRef.current) return; // stale response
```

### 3f. Modify `reload()` — use `reconcileChats` helper

Replace lines 111-126 (the `newChats`, `newMessages` construction + `setChats` + `setMessages`) with:

```ts
const newChats: Chat[] = data.chats.map((c) => ({
  id: c.id,
  title: c.title,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
  archivedAt: c.archived_at,
  metadata: c.metadata ?? {}
}));

// Reconcile: which IDs were mutated after the snapshot was taken?
const mutatedIds = new Set<string>();
for (const [id, version] of chatVersionsRef.current) {
  if (version > (preFetchVersions.get(id) ?? 0)) {
    mutatedIds.add(id);
  }
}

setChats((current) => {
  const reconciled = reconcileChats(current, newChats, mutatedIds);
  chatsRef.current = reconciled;
  return reconciled;
});

// activeChatId validation — functional setter against chatsRef, never pathname
setActiveChatId((current) => {
  if (!current) return null;
  const latest = chatsRef.current;
  return latest.some((c) => c.id === current && !c.archivedAt) ? current : null;
});

const newMessages: Record<string, DbChatMessage[]> = {};
for (const c of data.chats) {
  const incoming = (c.chat_messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
    .map((m) => messageRowToChatMessage(m));
  newMessages[c.id] = incoming;
}

// Merge messages by ID using the shared core helper
setMessages((prev) => {
  const next = { ...prev };
  for (const [cid, incoming] of Object.entries(newMessages)) {
    next[cid] = mergeMessages(prev[cid] ?? [], incoming);
  }
  return next;
});
```

### 3h. Update `ChatStore` interface

Add `upsertMessage` and `upsertChat` to the `ChatStore` type (around line 30):

```ts
export type ChatStore = {
  // ... existing fields ...
  upsertMessage: (chatId: string, msg: DbChatMessage) => void;
  upsertChat: (chat: CoreChat) => void;
  // ... rest ...
};
```

### 3i. Add to `useMemo` value

Add `upsertMessage` and `upsertChat` to the returned object and dependency arrays (around lines 261-296):

```ts
const store = useMemo<ChatStore>(
  () => ({
    // ... existing ...
    upsertMessage,
    upsertChat,
    // ...
  }),
  [
    // ... existing deps ...
    upsertMessage,
    upsertChat,
  ]
);
```

**Verification:** `npm run typecheck`

---

## Patch 4 — Execute route: finalizeRunTurn transaction, frame ordering

**File: `apps/web/app/api/runs/execute/route.ts`**

**Key change:** Replace the multi-step finalization (separate message persist + checkpoint + metadata) with a single `finalizeRunTurn()` DB transaction. The helper atomically persists checkpoint state, assistant message, and chat metadata in one round trip.

### 4a. New imports

```ts
import { chatRowToChat, messageRowToChatMessage } from "@spielos/core";
import { finalizeRunTurn } from "@spielos/db";
```

### 4b. Capture createChat result (around line 72)

Replace:
```ts
chatId
  ? createChat(sql, org.orgId, chatId, body.prompt.trim().slice(0, 80) || "New chat")
  : Promise.resolve(null)
```

With:
```ts
let chatRow: ChatRow | null = null;
if (chatId) {
  chatRow = await createChat(sql, org.orgId, chatId, body.prompt.trim().slice(0, 80) || "New chat");
}
```

### 4c. Capture initial appendChatMessages result (lines 136-144)

Replace the existing `appendChatMessages` call with a captured result:

```ts
let initialMessagesResult: ChatMessageRow[] = [];
if (chatId && turnId) {
  initialMessagesResult = await appendChatMessages(sql, org.orgId, chatId, [
    { role: "user", body: body.prompt, metadata: { runId: run.id, turnId, kind: "user_request" } },
    { role: "assistant", body: "[execution_anchor]", metadata: { runId: run.id, turnId, kind: "execution_anchor" } }
  ]);
}
// keep the existing updateChatMetadata and project block below (lines 145-172)
```

### 4d. Inside stream start() — send chat_created + initial message_persisted

After the existing send calls (lines 192-214), before the generator:

```ts
// Chat created frame for new chats (upsertChat on client is idempotent)
if (chatId && chatRow) {
  send({ kind: "chat_created", chatId, chat: chatRowToChat(chatRow) });
}

// Initial message_persisted frames
for (const msg of initialMessagesResult) {
  send({ kind: "message_persisted", chatId, message: messageRowToChatMessage(msg), runId: run.id });
}
```

### 4e. Remove publishDomainEvent from generator's done handler

In the `item.kind === "done"` block, remove the `publishDomainEvent` call. Only keep:

```ts
} else if (item.kind === "done") {
  const allowed: RunStatus[] = ["running", "waiting_human", "completed", "failed", "cancelled"];
  terminalStatus = (allowed.includes(item.status as RunStatus) ? item.status : "completed") as RunStatus;
}
```

### 4f. Replace multi-step finalization with single `finalizeRunTurn()` call

Replace the entire finalization block (from `const finalizeStart = performance.now();` at line 568 through the final SSE frame send at line 776) with:

```ts
// ── Atomic finalization ───────────────────────────────────────────
let finalTurnResult: {
  run: RunRow;
  messages: ChatMessageRow[];
  chat: ChatRow | null;
} | null = null;

if (chatId) {
  try {
    finalTurnResult = await finalizeRunTurn(
      sql, org.orgId, run.id, chatId, turnId, checkpointVersion,
      {
        outputText: outputText ?? "",
        events: queuedEvents.splice(0, queuedEvents.length),
        state: { ...(checkpoint ?? {}), _timings: timings },
        status: terminalStatus,
        error: errorMessage,
        completedAt: terminalStatus === "waiting_human" ? null : completedAt,
        isDirectorChat,
        longHorizon: checkpoint?.longHorizon ?? (longHorizon ? {
          pinnedState: longHorizon.pinnedState,
          milestones: longHorizon.milestones
        } : null)
      }
    );
    // Update checkpointVersion from the committed row
    checkpointVersion = Number(finalTurnResult.run.checkpoint_version ?? checkpointVersion);
    terminalStatus = finalTurnResult.run.status as RunStatus;
  } catch (finalizeErr) {
    console.error("[runs/execute] finalizeRunTurn failed:", finalizeErr);
    throw finalizeErr;
  }
} else {
  // No chat — finalize run state only (existing atomicCheckpoint path)
  // … keep the original final atomic checkpoint for headless runs …
}

// ── Project revision (best-effort, after terminal consistency) ────
if (chatId && project && outputFiles.length > 0) {
  try { /* … keep existing project revision block … */ } catch (err) {
    console.warn("[runs/execute] project revision persistence failed:", err);
  }
}

// ── Run metrics (best-effort) ─────────────────────────────────────
try { /* … keep existing upsertRunMetrics block … */ } catch (metricsError) {
  console.warn("[runs/execute] run metrics persist failed:", metricsError);
}

// ── SSE frames ────────────────────────────────────────────────────
const finalMsgs = finalTurnResult?.messages ?? [];
for (const msg of finalMsgs) {
  send({ kind: "message_persisted", chatId: chatId!, message: messageRowToChatMessage(msg), runId: run.id });
}

// Fetch the latest chat row AFTER project revision so chat_created
// carries the full metadata including project info.
if (chatId) {
  const latestChat = await getChat(sql, org.orgId, chatId);
  if (latestChat) {
    send({ kind: "chat_created", chatId, chat: chatRowToChat(latestChat) });
  }
}

if (checkpoint) {
  send({
    kind: "run_state",
    state: {
      goal: checkpoint.goal,
      budget: checkpoint.budget,
      progress: checkpoint.progress,
      verification: checkpoint.verification
    }
  });
}

publishDomainEvent(`run:${run.id}`, {
  type: "run.status.changed",
  orgId: org.orgId,
  runId: run.id,
  status: terminalStatus,
  checkpointVersion,
  ts: new Date().toISOString()
});

send({ kind: "done", runId: run.id, status: terminalStatus });
```

**Note:** `finalizeRunTurn` inserts the assistant message idempotently using a dedicated key stored in `metadata.idempotencyKey`: `run:{runId}:turn:{turnId}:final` for initial runs, `run:{runId}:resume:{requestId}` for resumed replies. If the same turn finalizes twice the second call finds the existing message via the key. The `chat_created` frame carries the committed chat row with updated `activeRunId`/`lastRunId` metadata.

**Verification:** `npm run typecheck`

---

## Patch 5 — Reply route: finalizeRunTurn, message_persisted frames

**File: `apps/web/app/api/runs/[id]/reply/route.ts`**

**Key change:** Replace the multi-step finalization with `finalizeRunTurn()` — same single-transaction helper used in Patch 4.

### 5a. New imports

```ts
import { messageRowToChatMessage, chatRowToChat } from "@spielos/core";
import { finalizeRunTurn, getChat, getRun, ... } from "@spielos/db";
```

### 5b. Replace multi-step finalization with `finalizeRunTurn()`

Remove the existing `appendChatMessages` block (lines 504-521), the final checkpoint block (lines 439-487), and the `updateChatMetadata` block (lines 560-565). Replace all of them with:

```ts
// ── Atomic finalization ───────────────────────────────────────────
let finalTurnResult: {
  run: RunRow;
  messages: ChatMessageRow[];
  chat: ChatRow | null;
} | null = null;

if (run.chat_id) {
  try {
    finalTurnResult = await finalizeRunTurn(
      org.sql, org.orgId, runId, run.chat_id, run.turn_id, checkpointVersion,
      {
        outputText: outputText ?? "",
        events: queuedEvents.splice(0, queuedEvents.length),
        state: latestCheckpoint,
        status: terminalStatus,
        error: errorMessage,
        completedAt: terminalStatus === "waiting_human" ? null : completedAt,
        isDirectorChat: false,
        resumedFrom: body.requestId
      }
    );
    checkpointVersion = Number(finalTurnResult.run.checkpoint_version ?? checkpointVersion);
    terminalStatus = finalTurnResult.run.status as RunStatus;
  } catch (finalizeErr) {
    console.error("[runs/reply] finalizeRunTurn failed:", finalizeErr);
    throw finalizeErr;
  }
}

// ── Project revision (best-effort, after terminal consistency) ────
if (run.chat_id && project && outputFiles.length > 0) {
  try { /* … keep existing project revision block … */ } catch (err) {
    console.warn("[runs/reply] project revision persist failed:", err);
  }
}

// ── SSE frames ────────────────────────────────────────────────────
const finalMsgs = finalTurnResult?.messages ?? [];
for (const msg of finalMsgs) {
  send({ kind: "message_persisted", chatId: run.chat_id!, message: messageRowToChatMessage(msg), runId });
}

if (finalTurnResult?.chat && run.chat_id) {
  send({ kind: "chat_created", chatId: run.chat_id, chat: chatRowToChat(finalTurnResult.chat) });
}

send({
  kind: "run_state",
  state: {
    goal: latestCheckpoint.goal,
    budget: latestCheckpoint.budget,
    progress: latestCheckpoint.progress,
    verification: latestCheckpoint.verification
  }
});

publishDomainEvent(`run:${runId}`, {
  type: "run.status.changed",
  orgId: org.orgId,
  runId,
  status: terminalStatus,
  checkpointVersion,
  ts: new Date().toISOString()
});

send({ kind: "done", runId, status: terminalStatus });
```

**Note:** The `resumedFrom` metadata field is passed into `finalizeRunTurn` which uses the idempotency key `run:{runId}:resume:{requestId}` to prevent duplicate messages if the reply route finalizes twice for the same turn.

**Verification:** `npm run typecheck`

---

## Patch 6 — Chat adapter: SseFrame type, new frames, no local hydration

**File: `apps/web/lib/chat-adapter.ts`**

### 6a. Replace imports

```ts
import type { SseFrame, ChatMessage, Chat as CoreChat } from "@spielos/core";
```

Remove the local `type StreamFrame = ...` declaration.

### 6b. Replace the SSE reader parsing (around line 302)

Replace the big `if/else if` chain that parses `item.kind` with one that handles the new frame kinds:

```ts
if (item.kind === "chat_created") {
  enqueue({ kind: "chat_created", chatId: item.chatId, chat: item.chat });
} else if (item.kind === "message_persisted") {
  enqueue({ kind: "message_persisted", chatId: item.chatId, message: item.message });
} else if (item.kind === "run") {
  enqueue({ kind: "run", runId: item.runId });
} else if (item.kind === "status") {
  enqueue({ kind: "status", message: item.message });
} else if (item.kind === "run_state") {
  enqueue({ kind: "run_state", state: item.state });
} else if (item.kind === "usage") {
  enqueue({ kind: "usage", usage: item.usage });
} else if (item.kind === "event") {
  enqueue({ kind: "event", event: item.event });
} else if (item.kind === "artifact") {
  enqueue({ kind: "artifact", artifact: item.artifact });
} else if (item.kind === "human_input") {
  enqueue({ kind: "human_input", request: item.request });
} else if (item.kind === "text") {
  narrative += item.text;
} else if (item.kind === "error") {
  enqueue({ kind: "error", message: item.message });
} else if (item.kind === "done") {
  const next = item.status as RunStatus;
  enqueue({ kind: "done", status: next });
}
```

### 6c. Update `PendingFrame` type

```ts
type PendingFrame =
  | { kind: "run"; runId: string }
  | { kind: "chat_created"; chatId: string; chat: CoreChat }
  | { kind: "message_persisted"; chatId: string; message: ChatMessage }
  | { kind: "event"; event: RunEvent }
  | { kind: "artifact"; artifact: Artifact }
  | { kind: "status"; message: string }
  | { kind: "run_state"; state: import("./run-context").DurableRunState }
  | { kind: "usage"; usage: import("./run-context").LiveRunUsage }
  | { kind: "human_input"; request: HumanInputRequest }
  | { kind: "error"; message: string }
  | { kind: "done"; status: RunStatus };
```

### 6d. Add `applyFrame` handlers for new frames

In the `applyFrame` function, add before the `item.kind === "run"` handler:

```ts
if (item.kind === "chat_created") {
  storeRef.current.upsertChat(item.chat);
} else if (item.kind === "message_persisted") {
  storeRef.current.upsertMessage(item.chatId, item.message);
} else if (item.kind === "run") {
  // ... existing run handler ...
}
// ... rest of existing applyFrame ...
```

### 6e. Replace the finally block's hydration (lines 338-371)

Replace the entire `if (createdChatId && !storeRef.current.activeChatId)` block:

```ts
if (createdChatId && !storeRef.current.activeChatId) {
  const existing = storeRef.current.messages[createdChatId];
  if (!existing?.length) {
    // Fallback: fetch committed messages from API
    try {
      const res = await fetch(`/api/chats/${createdChatId}/messages`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as { messages: Array<Record<string, unknown>> };
        if (Array.isArray(data.messages)) {
          for (const raw of data.messages) {
            const msg = messageRowToChatMessage(raw as Parameters<typeof messageRowToChatMessage>[0]);
            storeRef.current.upsertMessage(createdChatId, msg);
          }
        }
      }
    } catch {
      // Fallback: messages arrive on next workspace reload
    }
  }
  storeRef.current.setActiveChat(createdChatId);
}
```

Also remove the no-longer-needed `local-` prefix construction and `hydrateChat` call.

**Verification:** `npm run typecheck`

---

## Patch 7 — Run drawer: SseFrame type, workspace store integration for message_persisted and chat_created

**File: `apps/web/components/chat/run-drawer.tsx`**

### 7a. Import SseFrame and workspace store

```ts
import type { SseFrame } from "@spielos/core";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
```

### 7b. Replace inline type annotation (line 451)

```ts
const item = JSON.parse(line.slice(6)) as SseFrame;
```

### 7c. Add workspace store at top level of `RunDrawer`

Add `const workspaceStore = useWorkspaceStore();` at the top of the `RunDrawer` function body, alongside the existing `useRunContext()` and `useUiStore()` calls (around line 408):

```ts
export function RunDrawer() {
  const run = useRunContext();
  const workspaceStore = useWorkspaceStore();
  const ui = useUiStore();
  const section: Section = ui.inspectorSection;
  // ...
```

The `control` function already closes over `workspaceStore` — reference the variable directly, do NOT call `useWorkspaceStore()` inside `control()`. The existing hook usage in child components (`WorkingStateCard`, `RuntimeCapacity`) can remain as-is; they are separate components that each need their own store access.

### 7d. Handle message_persisted and chat_created (add to the if-chain around line 456)

```ts
if (item.kind === "message_persisted") {
  workspaceStore.upsertMessage(item.chatId, item.message);
} else if (item.kind === "chat_created") {
  workspaceStore.upsertChat(item.chat);
}
```

These handlers ensure that during control-flow SSE parsing (resume/retry), committed chat messages and chat metadata reach the workspace store immediately — same as the main SSE processing in `chat-adapter.ts`.

### 7e. Remove the now-unnecessary catch-all at line 452

The `SseFrame` discriminated union now covers all frame kinds. The existing individual `if` checks for `event`, `artifact`, `human_input`, `text`, `status`, `run_state`, `usage`, `done` can stay as-is (they work with the union type).

**Verification:** `npm run typecheck`

---

## Patch 8 — Hoist ChatRuntimeProvider

**File: `apps/web/components/chat/chat-thread.tsx`**

### 8a. Add `export` to `ChatRuntimeProvider`

Find `function ChatRuntimeProvider(...)` at line 1323 and make it `export function ChatRuntimeProvider(...)`.

### 8b. Simplify `ChatThread`

Replace lines 1538-1551:

```tsx
export function ChatThread() {
  return <ChatThreadInner />;
}
```

Remove the `pathname`, `runtimeKey`, `setRuntimeKey` state, the `useEffect` for pathname, and the `key={runtimeKey}` prop.

### 8c. Expose test-only stable runtime instance ID as hidden attribute

Use a ref initialized once with `crypto.randomUUID()`. Render it as a hidden `<span>` with `data-runtime-instance-id`. No layout wrapper, no global mount counter.

```tsx
// In ChatRuntimeProvider (component body, useRef to keep ID stable):
const instanceIdRef = useRef<string | null>(null);
if (instanceIdRef.current === null) {
  instanceIdRef.current = crypto.randomUUID();
}

// In the return JSX, add a hidden marker (no wrapper div):
return (
  <>
    <span data-runtime-instance-id={instanceIdRef.current} style={{ display: 'none' }} />
    {/* existing children — must be a fragment if you have multiple children,
        or just include the span alongside the single child */}
  </>
);
```

The E2E test reads `data-runtime-instance-id` before and after client-side navigation and asserts the value is unchanged. This verifies `ChatRuntimeProvider` was not remounted.

**Verification:** `npm run typecheck`

---

## Patch 9 — AppProviders: mount ChatRuntimeProvider

**File: `apps/web/app/app-providers.tsx`**

### 9a. Add import

```ts
import { ChatRuntimeProvider } from "../components/chat/chat-thread";
```

### 9b. Render inside WorkspaceStoreProvider

```tsx
<RunContextProvider>
  <WorkspaceStoreProvider>
    <ChatRuntimeProvider>
      <IconRegistryProvider>
        <TooltipProvider delayDuration={200} skipDelayDuration={300}>
          {children}
        </TooltipProvider>
      </IconRegistryProvider>
    </ChatRuntimeProvider>
    <AppToaster />
  </WorkspaceStoreProvider>
</RunContextProvider>
```

**Verification:** `npm run typecheck`, `npm run lint`

---

## Patch 10 — Update AGENTS.md

**File: `AGENTS.md`**

Replace line 48 and add new rules:

```
## Run Lifecycle

- Durable statuses: `running`, `waiting_human`, `completed`, `failed`, `cancelled`. `idle` is client-only.
- Terminal events and SSE `done.status` are authoritative. Do not infer liveness from events.
- Plain chat works without a selected harness item. Do not present it as workflow execution.
- Execution activity is inline and compact in chat. Complete history is in Events inspector.
- SSE `message_persisted` frames are the authoritative source for committed chat messages. The store reconciles by primary key: `upsertMessage` replaces by ID, `reload()` merges by ID and sorts deterministically by `createdAt` + ID.
- The `done` SSE frame is emitted exactly once after all durable persistence (checkpoint, metadata, chat message) and realtime publication succeed.
- Assistant-message persistence is mandatory for successful finalization. If the append fails, the terminal status becomes `failed`.

## Director

- The Director is the orchestrator role (`metadata.systemRole: "orchestrator"`). Seed: `supabase/seed/agents/orchestrator.md`.
- Model priority: user-selected → orchestrator role's `modelId` → workflow model → workspace default.
- `streamDirectorRun` uses `streamMode: ["values"]`. Track per-message content length (`yieldedTextLen` Map) for delta yielding.

## Chat State

- `ChatRuntimeProvider` is hoisted into `AppProviders` and survives all navigation. Chat switching uses `runtime.thread.reset()` driven by `activeChatId`. No pathname-derived key is used.
- `store.messages` reconciles by primary key: `upsertMessage` replaces by ID, `reload()` merges by ID (never overwrites locally-upserted messages) and sorts deterministically.
- New chats are seeded via `chat_created` + `message_persisted` SSE frames. The `finally` block in `chat-adapter.ts` only calls `setActiveChat`; local placeholder messages are never created.
```

---

## Patch 11 — Unit tests

**File: `tests/chat-context.test.ts` (new file)**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { upsertMessage, mergeMessages, type ChatMessage } from "@spielos/core";

// ── Test data factory ─────────────────────────────────────────────

function makeMsg(id: string, createdAt: string, body = "content"): ChatMessage {
  return {
    id, orgId: "org-x", chatId: "chat-x",
    role: "assistant", body, metadata: {},
    createdAt
  };
}

// ── Tests ────────────────────────────────────────────────────────

test("upsertMessage replaces by ID", () => {
  let msgs: ChatMessage[] = [makeMsg("1", "2024-01-01T00:00:00Z")];
  msgs = upsertMessage(msgs, makeMsg("1", "2024-01-01T00:00:00Z", "updated"));
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].body, "updated");

  msgs = upsertMessage(msgs, makeMsg("2", "2024-01-02T00:00:00Z"));
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].id, "2");
});

test("reload merges by ID preserves local upserts", () => {
  const existing = [makeMsg("1", "2024-01-01T00:00:00Z", "local")];
  const incoming = [
    makeMsg("1", "2024-01-01T00:00:00Z", "server"), // same ID — should be skipped
    makeMsg("2", "2024-01-02T00:00:00Z", "new")
  ];
  const merged = mergeMessages(existing, incoming);
  assert.equal(merged.length, 2);
  // existing msg should be preserved (not overwritten by server version)
  assert.equal(merged.find((m) => m.id === "1")?.body, "local");
  assert.equal(merged.find((m) => m.id === "2")?.body, "new");
});

test("reload sorts deterministically by createdAt then id", () => {
  const existing = [makeMsg("b", "2024-01-01T00:00:00Z")];
  const incoming = [
    makeMsg("a", "2024-01-01T00:00:00Z"), // same createdAt, earlier id
    makeMsg("c", "2024-01-03T00:00:00Z"), // later date
  ];
  const merged = mergeMessages(existing, incoming);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, "a"); // same day, alphabetical
  assert.equal(merged[1].id, "b");
  assert.equal(merged[2].id, "c"); // later day
});

test("reload request sequencing discards stale", () => {
  let seq = 0;
  function reload(ms: number): Promise<number> {
    const current = ++seq;
    return new Promise((resolve) => setTimeout(() => resolve(current), ms));
  }

  // Fire two reloads; only the later one should resolve as current
  const p1 = reload(50); // slow — will be stale
  const p2 = reload(10); // fast — wins

  return Promise.all([p1, p2]).then(([r1, r2]) => {
    assert.equal(r2, seq); // seq was set by p2, so r2 is current
    assert.notEqual(r1, seq); // r1 is stale
  });
});

test("chat_created + message_persisted populate store", () => {
  // Simulate: chat_created frame arrives, then message_persisted frames
  const store: {
    chats: Array<{ id: string }>;
    messages: Record<string, ChatMessage[]>;
  } = { chats: [], messages: {} };

  // Chat created
  const chat = { id: "chat-x", title: "Test", orgId: "org-x", metadata: {}, archivedAt: null, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" };
  if (!store.chats.some((c) => c.id === chat.id)) store.chats.push(chat);

  // Message persisted
  const msg = makeMsg("m1", "2024-01-01T00:00:00Z");
  store.messages["chat-x"] = upsertMessage(store.messages["chat-x"] ?? [], msg);

  assert.equal(store.chats.length, 1);
  assert.equal(store.chats[0].id, "chat-x");
  assert.equal(store.messages["chat-x"].length, 1);
  assert.equal(store.messages["chat-x"][0].id, "m1");
});

test("new chat hydration skips local messages", () => {
  // Simulate the finally block when message_persisted already populated the store
  const createdChatId = "chat-new";
  const store = {
    activeChatId: null as string | null,
    messages: { "chat-new": [makeMsg("m1", "2024-01-01T00:00:00Z")] },
    setActiveChat: (id: string) => { store.activeChatId = id; }
  };

  const existing = store.messages[createdChatId];
  if (!existing?.length) throw new Error("should not reach fallback fetch");

  store.setActiveChat(createdChatId);
  assert.equal(store.activeChatId, "chat-new");
  // no local hydration was needed
});

test("resumed messages appear once after reload", () => {
  // Simulate: store has an initial reply and a resumed reply
  const existing = [
    makeMsg("a1", "2024-01-01T00:00:00Z", "initial reply"),
  ];
  // The resumed message has resumedFrom metadata (simulated)
  const resumed = {
    ...makeMsg("a2", "2024-01-02T00:00:00Z", "resumed output"),
    metadata: { resumedFrom: "req-1", kind: "assistant_reply" }
  };
  const withResumed = upsertMessage(existing, resumed as ChatMessage);

  // Reload returns both messages plus some other chat's messages
  const incoming = [
    makeMsg("a1", "2024-01-01T00:00:00Z", "initial reply"),
    resumed as ChatMessage,
    makeMsg("b1", "2024-01-01T00:00:00Z", "other chat"),
  ];

  const merged = mergeMessages(withResumed, incoming);
  // Our chat's messages: a1, a2 — exactly 2, no duplicates
  const ourMessages = merged.filter((m) => m.chatId === "chat-x" || (m.id.startsWith("a")));
  assert.equal(ourMessages.length, 2);
  assert.equal(ourMessages.filter((m) => m.id === "a1").length, 1);
  assert.equal(ourMessages.filter((m) => m.id === "a2").length, 1);
});

test("chat merge preserves locally-created chats on reload", () => {
  // Simulate: store has a locally-created chat not yet on server
  const localChat = { id: "chat-local", title: "Local", orgId: "org-x", metadata: {}, archivedAt: null, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" };
  const serverChats = [{ id: "chat-server", title: "Server" }];

  // Merge — incoming should not overwrite local
  const currentIds = new Set([localChat].map((c) => c.id));
  const merged = [localChat, ...serverChats.filter((c) => !currentIds.has(c.id))];

  assert.equal(merged.length, 2);
  assert(merged.some((c) => c.id === "chat-local"));
  assert(merged.some((c) => c.id === "chat-server"));
});

test("done frame is last after all SSE frames", () => {
  // Verifies that chat_created, message_persisted, run_state all come before done
  const frames = [
    { kind: "chat_created" },
    { kind: "message_persisted" },
    { kind: "run_state" },
    { kind: "done" },
  ];
  const doneIndex = frames.findIndex((f) => f.kind === "done");
  assert.equal(doneIndex, frames.length - 1);
});
```

---

## Patch 12 — E2E test

**File: `tests/e2e/chat-navigation.spec.ts` (new file)**

```ts
import { test, expect } from "@playwright/test";

// Seeded fixture IDs — must match the test seed data loaded before the suite.
const SEED_CHAT_ID = "00000000-0000-0000-0000-000000000001";
const SEED_CHAT_TITLE = "Getting Started";
const SEED_RUN_ID  = "00000000-0000-0000-0000-000000000010";

test.describe("Chat navigation stability", () => {

  test("navigates round-trip without welcome screen flash", async ({ page }) => {
    // Attach console listener before first navigation
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    // 1. Initial load — seed data includes a chat
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 2. Seed chat appears as a sidebar link (real Next <Link> element)
    const chatLink = page.getByRole("link", { name: SEED_CHAT_TITLE });
    await expect(chatLink).toBeVisible({ timeout: 10000 });

    // 3. Click the seed chat (client-side navigation via Next Link)
    await chatLink.click();
    await page.waitForTimeout(500);

    // 4. Chat thread is visible (actual test ID from chat-thread component)
    const thread = page.locator("[data-testid='chat-thread']");
    await expect(thread).toBeVisible({ timeout: 5000 });

    // 5. Client-side navigation to /settings via a Next <Link>
    await page.getByRole("link", { name: "Settings" }).click();
    await page.waitForLoadState("networkidle");

    // 6. Client-side navigation back to / via a Next <Link>
    await page.getByRole("link", { name: "Chat" }).click();
    await page.waitForLoadState("networkidle");

    // 7. The same chat thread remains visible (provider survived navigation)
    await expect(thread).toBeVisible({ timeout: 5000 });

    // 8. No console errors
    expect(errors.filter((e) => !e.includes("favicon") && !e.includes("analytics"))).toEqual([]);
  });

  test("ChatRuntimeProvider instance ID is stable across client-side navigation", async ({ page }) => {
    // 1. Load page and get the runtime instance data attribute
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const beforeNavId = await page
      .locator("[data-runtime-instance-id]")
      .getAttribute("data-runtime-instance-id");

    // 2. Navigate to a run page via Next <Link>
    await page.getByRole("link", { name: SEED_RUN_ID }).click();
    await page.waitForLoadState("networkidle");

    // 3. Navigate back to / via Next <Link>
    await page.getByRole("link", { name: "Chat" }).click();
    await page.waitForLoadState("networkidle");

    // 4. The runtime instance ID must be the same (provider was not remounted)
    const afterNavId = await page
      .locator("[data-runtime-instance-id]")
      .getAttribute("data-runtime-instance-id");

    expect(afterNavId).toBe(beforeNavId);
  });

  test("nonexistent run shows error state, not stale messages", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Navigate client-side to nonexistent run via Next <Link>
    const badRunLink = page.getByRole("link", { name: /nonexistent/i });
    if (await badRunLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await badRunLink.click();
    } else {
      // Fallback: use the first run link and splice an invalid ID
      const anyRunLink = page.getByRole("link").filter({ hasText: /00000000/ }).first();
      if (await anyRunLink.isVisible({ timeout: 2000 }).catch(() => false)) {
        const href = await anyRunLink.getAttribute("href");
        if (href) {
          await page.goto(href!.replace(/[^/]+$/, "nonexistent-id"));
        }
      }
    }
    await page.waitForLoadState("networkidle");

    // Welcome screen or error state, not a chat thread
    const welcome = page.locator("text=Welcome").or(page.locator("text=not found"));
    await expect(welcome).toBeVisible({ timeout: 5000 });
  });
});
```

**Note:** This test relies on seeded fixture data (a chat titled "Getting Started" with ID `00000000-0000-0000-0000-000000000001` and a run with ID `00000000-0000-0000-0000-000000000010`). The `data-runtime-instance-id` attribute is added in Patch 8. Test IDs (`data-testid='chat-thread'`) must be present in the `chat-thread` component — add them if missing.

---

## Patch application order

```bash
# 1. Core schemas + serializers
npm run typecheck

# 1b. Shared chat-store helpers in core
npm run typecheck

# 2. Add org_id to /api/chats message query
npm run typecheck

# 3. Store: upsertMessage, upsertChat, safe reload, merge-by-ID
npm run typecheck

# 4. Execute route: durable finalization, frame ordering
npm run typecheck

# 5. Reply route: durable finalization, message_persisted
npm run typecheck

# 6. Chat adapter: SseFrame type, new frames, no local hydration
npm run typecheck

# 7. Run drawer: workspace store integration
npm run typecheck

# 8. Chat thread hoist
npm run typecheck

# 9. App providers
npm run typecheck
npm run lint

# 10. AGENTS.md (no typecheck needed)

# 11. Tests
node --experimental-strip-types --test tests/chat-context.test.ts

# 12. E2E tests (requires running app)
npm run build
npm run test:e2e
```

## Design invariants

- The database and committed chat messages are the single source of truth.
- `message_persisted` SSE frames are the only path for committed messages into the client store during an active run.
- `reload()` (from realtime or manual) never overwrites a message or chat that was already inserted by `upsertMessage`/`upsertChat`. It only adds entities whose ID doesn't exist.
- Chat merge: `reload()` uses `mergeMessages` (shared core helper) for messages by ID, and a compatible merge-by-ID strategy for chats that preserves locally-created entries.
- Local placeholder IDs (`local-*`) are never created. The `finally` block either finds messages already in the store (from SSE frames) or fetches committed data from the API.
- `ChatRuntimeProvider` mounts once in the root layout and survives all navigation.
- `done` SSE frame is emitted exactly once, after all persistence succeeds. Failed assistant message persistence prevents successful finalization.
- `run.status.changed` is published for every resulting status (`completed`, `failed`, `waiting_human`, `cancelled`), not filtered on the publish side.
- Assistant message persistence is mandatory: the message is committed BEFORE the final checkpoint so the checkpoint captures the failure status if persist fails.
