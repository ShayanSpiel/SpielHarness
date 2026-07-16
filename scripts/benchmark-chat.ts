#!/usr/bin/env node
// Phase 0 benchmark: drives a warm-cache chat request against a running dev
// server, parses the SSE stream for first-token timing, and prints a metrics
// block that includes the persisted run_metrics row.
//
// Usage:
//   APP_URL=http://localhost:3000 \
//   COOKIE_BLOB='better-auth.session_token=...' \
//   npm run benchmark:chat
//
// Output is a single JSON document on stdout suitable for diffing
// before/after runs of the optimization plan.

import { setTimeout as sleep } from "node:timers/promises";

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const COOKIE_BLOB = process.env.COOKIE_BLOB ?? "";
const PROMPT = process.env.BENCH_PROMPT ?? "What is the capital of France?";
const REPEAT = Math.max(1, Number(process.env.BENCH_REPEAT ?? 3));
const MODEL_ID = process.env.BENCH_MODEL_ID ?? "";

if (!COOKIE_BLOB) {
  console.error("ERROR: COOKIE_BLOB environment variable is required (e.g. 'better-auth.session_token=...').");
  process.exit(1);
}

async function runOnce() {
  const reqStart = performance.now();
  const response = await fetch(`${APP_URL}/api/runs/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: COOKIE_BLOB
    },
    body: JSON.stringify({
      prompt: PROMPT,
      type: "chat",
      modelId: MODEL_ID || undefined,
      messages: [{ role: "user", content: PROMPT }],
      goal: {
        objective: PROMPT,
        constraints: [],
        successCriteria: ["Return a grounded response."]
      }
    })
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed: ${response.status} ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstByteAt = null;
  let firstTextAt = null;
  let firstEventAt = null;
  let firstStatusAt = null;
  let runId = null;
  let terminalStatus = null;
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (firstByteAt === null) firstByteAt = performance.now();
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      let frame;
      try {
        frame = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (frame.kind === "run" && firstStatusAt === null) {
        firstStatusAt = performance.now();
        runId = frame.runId;
      }
      if (frame.kind === "text" && firstTextAt === null) {
        firstTextAt = performance.now();
        text += frame.text;
      }
      if (frame.kind === "event" && firstEventAt === null) {
        firstEventAt = performance.now();
      }
      if (frame.kind === "done") {
        terminalStatus = frame.status;
      }
    }
    if (terminalStatus) break;
  }

  const total = performance.now() - reqStart;
  let metrics = null;
  if (runId) {
    const res = await fetch(`${APP_URL}/api/runs/${runId}/metrics`, { headers: { Cookie: COOKIE_BLOB } });
    if (res.ok) {
      const body = await res.json();
      metrics = body.metrics;
    }
  }

  return {
    runId,
    terminalStatus,
    firstByteMs: firstByteAt !== null ? firstByteAt - reqStart : null,
    firstStatusMs: firstStatusAt !== null ? firstStatusAt - reqStart : null,
    firstEventMs: firstEventAt !== null ? firstEventAt - reqStart : null,
    firstTextMs: firstTextAt !== null ? firstTextAt - reqStart : null,
    totalMs: total,
    textLength: text.length,
    metrics
  };
}

async function main() {
  const results = [];
  for (let i = 0; i < REPEAT; i += 1) {
    if (i > 0) await sleep(250);
    const result = await runOnce();
    results.push(result);
    process.stderr.write(`[${i + 1}/${REPEAT}] run ${result.runId} status=${result.terminalStatus} total=${result.totalMs.toFixed(1)}ms firstText=${(result.firstTextMs ?? 0).toFixed(1)}ms\n`);
  }
  process.stdout.write(JSON.stringify({ results, prompt: PROMPT, at: new Date().toISOString() }, null, 2) + "\n");
}

main().catch((err) => {
  console.error("benchmark:chat failed:", err);
  process.exit(1);
});
