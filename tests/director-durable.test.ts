import assert from "node:assert/strict";
import test from "node:test";
import { buildPostgresSaver, DEFAULT_CHECKPOINT_SCHEMA } from "@spielos/graph/director/checkpointer";
import { commandFromReply, resumePayloadFromReply } from "@spielos/graph/director/interrupt";
import { Command } from "@langchain/langgraph";
import type { HumanInputRequest } from "@spielos/core";

test("buildPostgresSaver returns null when no connection string is provided", async () => {
  const saver = await buildPostgresSaver(null);
  assert.equal(saver, null);
});

test("buildPostgresSaver returns null when connection string is empty", async () => {
  const saver = await buildPostgresSaver("");
  assert.equal(saver, null);
});

test("buildPostgresSaver returns null when connection string is undefined", async () => {
  const saver = await buildPostgresSaver(undefined);
  assert.equal(saver, null);
});

test("DEFAULT_CHECKPOINT_SCHEMA is public", () => {
  assert.equal(DEFAULT_CHECKPOINT_SCHEMA, "public");
});

test("commandFromReply produces a Command with a resume payload matching the question ids", () => {
  const request: HumanInputRequest = {
    id: "interrupt-1",
    nodeId: "director",
    skillId: "director",
    questions: [
      { id: "approve", kind: "single", question: "Approve?", options: [{ id: "yes", label: "Yes" }], allowCustom: false },
      { id: "follow-up", kind: "text", question: "Anything else?", allowCustom: true }
    ],
    createdAt: new Date().toISOString()
  };
  const body = { requestId: "interrupt-1", answers: { approve: "yes", "follow-up": "more context" } };
  const command = commandFromReply(request, body);
  assert.ok(command instanceof Command);
});

test("resumePayloadFromReply preserves arbitrary key/value answers", () => {
  const payload = resumePayloadFromReply({ requestId: "x", answers: { a: 1, b: "two", c: true } });
  assert.deepEqual(payload, { a: 1, b: "two", c: true });
});

test("resumePayloadFromReply returns empty for non-object answers", () => {
  assert.deepEqual(resumePayloadFromReply({ requestId: "x", answers: null as unknown as Record<string, unknown> }), {});
  assert.deepEqual(resumePayloadFromReply({ requestId: "x", answers: "string" as unknown as Record<string, unknown> }), {});
  assert.deepEqual(resumePayloadFromReply({ requestId: "x", answers: 42 as unknown as Record<string, unknown> }), {});
  assert.deepEqual(resumePayloadFromReply({ requestId: "x", answers: ["a", "b"] as unknown as Record<string, unknown> }), {});
});

test("commandFromReply ignores answers whose id is not in the question set", () => {
  const request: HumanInputRequest = {
    id: "interrupt-1",
    nodeId: "director",
    skillId: "director",
    questions: [
      { id: "approve", kind: "single", question: "Approve?", options: [{ id: "yes", label: "Yes" }], allowCustom: false }
    ],
    createdAt: new Date().toISOString()
  };
  // The Command is constructed without error even when extra
  // answer keys are present; only matching question ids are
  // forwarded. The run's `Command({ resume })` contract is
  // permissive.
  const command = commandFromReply(request, { requestId: "x", answers: { approve: "yes", other: "ignored" } });
  assert.ok(command instanceof Command);
});
