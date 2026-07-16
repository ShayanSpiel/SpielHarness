import assert from "node:assert/strict";
import test from "node:test";

import {
  publishDomainEvent,
  subscribeDomainEvent,
  type DomainEvent
} from "../apps/web/lib/realtime.ts";

/**
 * Phase 4 covers realtime domain events. The transport is in-process
 * (Node EventEmitter) for MVP. The relay in `/api/realtime` and the
 * browser-side `useRealtimeSubscription` are thin adapters over this
 * transport; swapping in Supabase Realtime later only changes the
 * transport implementation, not the publisher or subscriber
 * contracts.
 */

test("publishDomainEvent delivers to subscribers on the matching topic", () => {
  const received: DomainEvent[] = [];
  const off = subscribeDomainEvent("org:org-1", (event) => received.push(event));
  publishDomainEvent("org:org-1", {
    type: "file.created",
    orgId: "org-1",
    fileId: "f-1",
    fileType: "knowledge",
    title: "Test",
    ts: new Date().toISOString()
  });
  off();
  assert.equal(received.length, 1);
  assert.equal(received[0].type, "file.created");
});

test("run-scoped events fan out to the org-scoped topic", () => {
  const received: DomainEvent[] = [];
  const off = subscribeDomainEvent("org:org-2", (event) => received.push(event));
  publishDomainEvent("run:run-99", {
    type: "run.status.changed",
    orgId: "org-2",
    runId: "run-99",
    status: "completed",
    checkpointVersion: 1,
    ts: new Date().toISOString()
  });
  off();
  assert.equal(received.length, 1);
  assert.equal(received[0].type, "run.status.changed");
});

test("subscribers on other orgs do not see events", () => {
  const org1: DomainEvent[] = [];
  const org2: DomainEvent[] = [];
  const off1 = subscribeDomainEvent("org:org-A", (e) => org1.push(e));
  const off2 = subscribeDomainEvent("org:org-B", (e) => org2.push(e));
  publishDomainEvent("org:org-A", {
    type: "context.invalidated",
    orgId: "org-A",
    reason: "x",
    ts: new Date().toISOString()
  });
  off1();
  off2();
  assert.equal(org1.length, 1);
  assert.equal(org2.length, 0);
});

test("unsubscribe stops further delivery", () => {
  const received: DomainEvent[] = [];
  const off = subscribeDomainEvent("org:org-3", (e) => received.push(e));
  publishDomainEvent("org:org-3", {
    type: "context.invalidated",
    orgId: "org-3",
    reason: "first",
    ts: new Date().toISOString()
  });
  off();
  publishDomainEvent("org:org-3", {
    type: "context.invalidated",
    orgId: "org-3",
    reason: "second",
    ts: new Date().toISOString()
  });
  assert.equal(received.length, 1);
});

test("publishDomainEvent does not throw when the topic has no subscribers", () => {
  // No subscribers on this topic; the publish should be a no-op.
  assert.doesNotThrow(() => {
    publishDomainEvent("run:run-nobody", {
      type: "run.output.updated",
      orgId: "org-x",
      runId: "run-nobody",
      text: "hi",
      ts: new Date().toISOString()
    });
  });
});
