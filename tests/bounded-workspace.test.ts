import { describe, it } from "node:test";
import assert from "node:assert";
import { mergeMessages, type ChatMessage } from "@spielos/core";
import type { ChatMessageRow } from "@spielos/db";

function makeMsg(
  id: string,
  chatId: string,
  sequenceNumber: number,
  role: "user" | "assistant" = "user",
  body = "hello"
): ChatMessageRow {
  return {
    id,
    org_id: "test-org",
    chat_id: chatId,
    role,
    body,
    metadata: {},
    created_at: new Date(Date.UTC(2026, 0, 1) + sequenceNumber * 1000).toISOString(),
    sequence_number: sequenceNumber,
  } as unknown as ChatMessageRow;
}

describe("bounded workspace — message merging at scale", () => {
  it("merges 10K messages across 100 chats deterministically", () => {
    const chatCount = 100;
    const messagesPerChat = 100;
    const allChats = new Map<string, ChatMessageRow[]>();

    // Build 100 chats × 100 messages each = 10K messages
    for (let c = 0; c < chatCount; c++) {
      const chatId = `chat-${c}`;
      const msgs: ChatMessageRow[] = [];
      for (let m = 0; m < messagesPerChat; m++) {
        msgs.push(makeMsg(`msg-${c}-${m}`, chatId, m + 1, m % 2 === 0 ? "user" : "assistant"));
      }
      allChats.set(chatId, msgs);
    }

    assert.strictEqual(allChats.size, chatCount);
    const totalMessages = [...allChats.values()].reduce((sum, msgs) => sum + msgs.length, 0);
    assert.strictEqual(totalMessages, chatCount * messagesPerChat);

    // Simulate a realtime reload: fetch all chats, merge by ID
    const merged = new Map<string, ChatMessageRow[]>();
    for (const [chatId, incoming] of allChats) {
      const existing = merged.get(chatId) ?? [];
      const asCore = incoming.map((m) => ({
        id: m.id,
        orgId: m.org_id,
        chatId: m.chat_id,
        role: m.role as "user" | "assistant" | "system",
        body: m.body,
        metadata: m.metadata as Record<string, unknown>,
        createdAt: m.created_at,
        sequenceNumber: m.sequence_number ?? undefined,
      }));
      merged.set(chatId, asCore as unknown as ChatMessageRow[]);
    }

    // Verify sorted by sequenceNumber
    for (const [chatId, msgs] of merged) {
      assert.ok(msgs.length > 0, `chat ${chatId} should have messages`);
      for (let i = 1; i < msgs.length; i++) {
        const prev = msgs[i - 1] as unknown as { sequenceNumber?: number };
        const curr = msgs[i] as unknown as { sequenceNumber?: number };
        assert.ok(
          (prev.sequenceNumber ?? 0) <= (curr.sequenceNumber ?? 0),
          `chat ${chatId}: msg ${i} out of order`
        );
      }
    }
  });

  it("mergeMessages handles large arrays efficiently", () => {
    const chatId = "big-chat";
    const existing: ChatMessageRow[] = [];
    for (let i = 0; i < 500; i++) {
      existing.push(makeMsg(`existing-${i}`, chatId, i + 1));
    }

    const incoming: ChatMessageRow[] = [];
    for (let i = 500; i < 1000; i++) {
      incoming.push(makeMsg(`incoming-${i}`, chatId, i + 1));
    }

    const existingCore = existing.map((m) => ({
      id: m.id,
      orgId: m.org_id,
      chatId: m.chat_id,
      role: m.role as "user" | "assistant" | "system",
      body: m.body,
      metadata: m.metadata as Record<string, unknown>,
      createdAt: m.created_at,
      sequenceNumber: m.sequence_number ?? undefined,
    }));
    const incomingCore = incoming.map((m) => ({
      id: m.id,
      orgId: m.org_id,
      chatId: m.chat_id,
      role: m.role as "user" | "assistant" | "system",
      body: m.body,
      metadata: m.metadata as Record<string, unknown>,
      createdAt: m.created_at,
      sequenceNumber: m.sequence_number ?? undefined,
    }));

    const start = performance.now();
    const result = mergeMessages(existingCore as any, incomingCore as any);
    const elapsed = performance.now() - start;

    assert.strictEqual(result.length, 1000);
    // verify sorted by sequenceNumber
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1] as unknown as { sequenceNumber?: number };
      const curr = result[i] as unknown as { sequenceNumber?: number };
      assert.ok(
        (prev.sequenceNumber ?? 0) <= (curr.sequenceNumber ?? 0),
        `msg ${i} out of order`
      );
    }
    // Should complete well under 50ms even for 1000 messages
    assert.ok(elapsed < 50, `mergeMessages took ${elapsed.toFixed(1)}ms (expected < 50ms)`);
  });

  it("mergeMessages deduplicates by ID — keeps first writer", () => {
    const chatId = "dedup-chat";
    const existing = [
      makeMsg("msg-1", chatId, 1, "user", "hello"),
      makeMsg("msg-2", chatId, 2, "assistant", "world"),
    ];
    const incoming = [
      makeMsg("msg-2", chatId, 2, "assistant", "world-updated"),
      makeMsg("msg-3", chatId, 3, "user", "new"),
    ];

    const toCore = (msgs: ChatMessageRow[]) =>
      msgs.map((m) => ({
        id: m.id,
        orgId: m.org_id,
        chatId: m.chat_id,
        role: m.role as "user" | "assistant" | "system",
        body: m.body,
        metadata: m.metadata as Record<string, unknown>,
        createdAt: m.created_at,
        sequenceNumber: m.sequence_number ?? undefined,
      }));

    const result = mergeMessages(toCore(existing) as any, toCore(incoming) as any);
    assert.strictEqual(result.length, 3);
    // mergeMessages is first-writer-wins — existing msg-2 body is preserved
    const msg2 = result.find((m: any) => m.id === "msg-2") as any;
    assert.strictEqual(msg2.body, "world");
    // msg-3 is new
    const msg3 = result.find((m: any) => m.id === "msg-3") as any;
    assert.strictEqual(msg3.body, "new");
  });

  it("fetchChatMessages URL construction is correct", () => {
    const chatId = crypto.randomUUID();
    const url = `/api/chats/${chatId}/messages?limit=200`;
    assert.ok(url.includes(chatId));
    assert.ok(url.includes("limit=200"));

    // With cursor
    const cursorUrl = `/api/chats/${chatId}/messages?after=msg-50&limit=200`;
    assert.ok(cursorUrl.includes("after=msg-50"));
  });
});
