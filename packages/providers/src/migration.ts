import {
  emptyPinnedState,
  type ChatPinnedState,
  type MilestoneSummary
} from "@spielos/core";

const LEGACY_COMPACTION_KEYS = ["summary", "compactedMessageCount", "compacted_message_count", "createdAt", "created_at", "messageCount", "message_count"];

/**
 * Read the legacy `chat.metadata.compaction` blob and produce a
 * candidate `ChatPinnedState` plus a legacy `MilestoneSummary` so the
 * next eligible turn can extract attributable operations from the raw
 * source messages and supersede the legacy entry.
 *
 * The legacy blob is one-shot prose. We never treat it as canonical
 * truth: it becomes a single milestone, not the currentPhase or any
 * authoritative decision.
 */
export function migrateLegacyCompaction(args: {
  metadata: Record<string, unknown> | null | undefined;
  chatId: string;
  now?: string;
}): { state: ChatPinnedState; milestone: MilestoneSummary | null; migrated: boolean } {
  const metadata = args.metadata ?? {};
  const candidate = metadata.compaction;
  if (!candidate || typeof candidate !== "object") {
    return { state: emptyPinnedState(args.now ?? new Date().toISOString()), milestone: null, migrated: false };
  }
  const source = candidate as Record<string, unknown>;
  const hasLegacyShape = LEGACY_COMPACTION_KEYS.some((key) => key in source);
  if (!hasLegacyShape) {
    return { state: emptyPinnedState(args.now ?? new Date().toISOString()), milestone: null, migrated: false };
  }
  const summary = typeof source.summary === "string"
    ? source.summary
    : typeof source.body === "string"
      ? source.body
      : "";
  const messageCount = Number(source.compactedMessageCount ?? source.compacted_message_count ?? source.messageCount ?? source.message_count ?? 0);
  const createdAt = typeof source.createdAt === "string"
    ? source.createdAt
    : typeof source.created_at === "string"
      ? source.created_at
      : args.now ?? new Date().toISOString();
  const milestone: MilestoneSummary = {
    id: `legacy-${args.chatId}`,
    title: "Legacy compaction summary",
    summary: summary || "(empty legacy summary)",
    decisionsMade: [],
    workCompleted: [],
    unresolvedItems: [],
    sourceMessageIds: [],
    createdAt
  };
  return {
    state: {
      ...emptyPinnedState(args.now ?? createdAt),
      currentPhase: null
    },
    milestone: messageCount > 0 ? milestone : null,
    migrated: Boolean(summary) && messageCount > 0
  };
}

export function readMilestonesFromMetadata(metadata: Record<string, unknown> | null | undefined): MilestoneSummary[] {
  const value = metadata?.milestones;
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      id: String(entry.id ?? ""),
      title: String(entry.title ?? "Milestone"),
      summary: String(entry.summary ?? ""),
      decisionsMade: Array.isArray(entry.decisionsMade) ? entry.decisionsMade.filter((value): value is string => typeof value === "string") : [],
      workCompleted: Array.isArray(entry.workCompleted) ? entry.workCompleted.filter((value): value is string => typeof value === "string") : [],
      unresolvedItems: Array.isArray(entry.unresolvedItems) ? entry.unresolvedItems.filter((value): value is string => typeof value === "string") : [],
      sourceMessageIds: Array.isArray(entry.sourceMessageIds) ? entry.sourceMessageIds.filter((value): value is string => typeof value === "string") : [],
      createdAt: String(entry.createdAt ?? "")
    }));
}
