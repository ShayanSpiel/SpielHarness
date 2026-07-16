import assert from "node:assert/strict";
import test from "node:test";
import { emptyPinnedState, type ChatPinnedState } from "@spielos/core";
import { migrateLegacyCompaction, readMilestonesFromMetadata } from "@spielos/providers";

test("migrateLegacyCompaction returns an empty state when the legacy blob is missing", () => {
  const result = migrateLegacyCompaction({ metadata: null, chatId: "c1", now: "2026-07-16T00:00:00.000Z" });
  assert.equal(result.migrated, false);
  assert.equal(result.milestone, null);
  assert.deepEqual(result.state, emptyPinnedState("2026-07-16T00:00:00.000Z"));
});

test("migrateLegacyCompaction returns an empty state when the metadata key has no legacy shape", () => {
  const result = migrateLegacyCompaction({
    metadata: { compaction: { unrelated: true } },
    chatId: "c1",
    now: "2026-07-16T00:00:00.000Z"
  });
  assert.equal(result.migrated, false);
  assert.equal(result.milestone, null);
});

test("migrateLegacyCompaction lifts the legacy prose into a single milestone", () => {
  const result = migrateLegacyCompaction({
    metadata: {
      compaction: {
        summary: "We agreed to use Stripe for the launch.",
        compactedMessageCount: 18,
        createdAt: "2026-07-15T10:00:00.000Z"
      }
    },
    chatId: "c42",
    now: "2026-07-16T00:00:00.000Z"
  });
  assert.equal(result.migrated, true);
  assert.equal(result.milestone?.title, "Legacy compaction summary");
  assert.match(result.milestone?.summary ?? "", /Stripe/);
  // Migration must not introduce authoritative decisions.
  const state: ChatPinnedState = result.state;
  assert.equal(state.decisions.length, 0);
  assert.equal(state.currentPhase, null);
});

test("migrateLegacyCompaction accepts snake_case legacy fields", () => {
  const result = migrateLegacyCompaction({
    metadata: {
      compaction: {
        summary: "snake case legacy",
        compacted_message_count: 9,
        created_at: "2026-07-15T10:00:00.000Z"
      }
    },
    chatId: "c43",
    now: "2026-07-16T00:00:00.000Z"
  });
  assert.equal(result.migrated, true);
  assert.equal(result.milestone?.id, "legacy-c43");
});

test("readMilestonesFromMetadata returns an empty array when no milestones exist", () => {
  const result = readMilestonesFromMetadata(null);
  assert.deepEqual(result, []);
  const result2 = readMilestonesFromMetadata({});
  assert.deepEqual(result2, []);
});

test("readMilestonesFromMetadata filters and normalizes the metadata list", () => {
  const milestones = readMilestonesFromMetadata({
    milestones: [
      {
        id: "m1",
        title: "First",
        summary: "Initial planning.",
        decisionsMade: ["Use Stripe"],
        workCompleted: ["Brief"],
        unresolvedItems: [],
        sourceMessageIds: ["m1"],
        createdAt: "2026-07-15T10:00:00.000Z"
      },
      "not an object",
      null
    ]
  });
  assert.equal(milestones.length, 1);
  assert.equal(milestones[0]?.title, "First");
  assert.deepEqual(milestones[0]?.decisionsMade, ["Use Stripe"]);
});
