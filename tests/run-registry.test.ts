import assert from "node:assert/strict";
import test from "node:test";

import { isRunActive, onRunSignal, registerRun, signalRun } from "../apps/web/lib/run-registry.ts";

/**
 * Phase 3 covers durable control without polling. The in-process
 * registry is the fast path that lets the cancel/pause routes
 * (which arrive on a separate request) signal the running execute
 * route's AbortController. The DB columns in `runs.cancel_requested_at`
 * and `runs.pause_requested_at` are the durable record; this test
 * only exercises the in-process path.
 */

test("registerRun returns an unregister function that removes the entry", () => {
  const controller = new AbortController();
  const unregister = registerRun("run-1", controller);
  assert.equal(isRunActive("run-1"), true);
  unregister();
  assert.equal(isRunActive("run-1"), false);
});

test("signalRun aborts the controller on cancel and dispatches listeners", () => {
  const controller = new AbortController();
  registerRun("run-2", controller);
  const reasons: string[] = [];
  onRunSignal("run-2", (reason) => reasons.push(reason));
  const ok = signalRun("run-2", "cancel");
  assert.equal(ok, true);
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(reasons, ["cancel"]);
});

test("signalRun dispatches pause listeners without aborting the controller", () => {
  const controller = new AbortController();
  registerRun("run-3", controller);
  const reasons: string[] = [];
  onRunSignal("run-3", (reason) => reasons.push(reason));
  const ok = signalRun("run-3", "pause");
  assert.equal(ok, true);
  assert.equal(controller.signal.aborted, false);
  assert.deepEqual(reasons, ["pause"]);
});

test("signalRun returns false for an unknown run", () => {
  const ok = signalRun("missing-run", "cancel");
  assert.equal(ok, false);
});

test("the unregister returned by onRunSignal detaches the listener", () => {
  const controller = new AbortController();
  registerRun("run-4", controller);
  const reasons: string[] = [];
  const off = onRunSignal("run-4", (reason) => reasons.push(reason));
  signalRun("run-4", "pause");
  off();
  signalRun("run-4", "cancel");
  assert.deepEqual(reasons, ["pause"]);
});
