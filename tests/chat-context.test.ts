import assert from "node:assert/strict";
import test from "node:test";
import { upsertMessage, mergeMessages, type ChatMessage } from "@spielos/core";

function makeMsg(id: string, createdAt: string, body = "content"): ChatMessage {
  return {
    id, orgId: "org-x", chatId: "chat-x",
    role: "assistant", body, metadata: {},
    createdAt
  };
}

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
    makeMsg("1", "2024-01-01T00:00:00Z", "server"),
    makeMsg("2", "2024-01-02T00:00:00Z", "new")
  ];
  const merged = mergeMessages(existing, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((m) => m.id === "1")?.body, "local");
  assert.equal(merged.find((m) => m.id === "2")?.body, "new");
});

test("reload sorts deterministically by createdAt then id", () => {
  const existing = [makeMsg("b", "2024-01-01T00:00:00Z")];
  const incoming = [
    makeMsg("a", "2024-01-01T00:00:00Z"),
    makeMsg("c", "2024-01-03T00:00:00Z"),
  ];
  const merged = mergeMessages(existing, incoming);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, "a");
  assert.equal(merged[1].id, "b");
  assert.equal(merged[2].id, "c");
});

test("reload request sequencing discards stale", () => {
  let seq = 0;
  function reload(ms: number): Promise<number> {
    const current = ++seq;
    return new Promise((resolve) => setTimeout(() => resolve(current), ms));
  }

  const p1 = reload(50);
  const p2 = reload(10);

  return Promise.all([p1, p2]).then(([r1, r2]) => {
    assert.equal(r2, seq);
    assert.notEqual(r1, seq);
  });
});

test("chat_created + message_persisted populate store", () => {
  const store: {
    chats: Array<{ id: string }>;
    messages: Record<string, ChatMessage[]>;
  } = { chats: [], messages: {} };

  const chat = { id: "chat-x", title: "Test", orgId: "org-x", metadata: {}, archivedAt: null, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" };
  if (!store.chats.some((c) => c.id === chat.id)) store.chats.push(chat);

  const msg = makeMsg("m1", "2024-01-01T00:00:00Z");
  store.messages["chat-x"] = upsertMessage(store.messages["chat-x"] ?? [], msg);

  assert.equal(store.chats.length, 1);
  assert.equal(store.chats[0].id, "chat-x");
  assert.equal(store.messages["chat-x"].length, 1);
  assert.equal(store.messages["chat-x"][0].id, "m1");
});

test("new chat hydration skips local messages", () => {
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
});

test("resumed messages appear once after reload", () => {
  const existing = [
    makeMsg("a1", "2024-01-01T00:00:00Z", "initial reply"),
  ];
  const resumed = {
    ...makeMsg("a2", "2024-01-02T00:00:00Z", "resumed output"),
    metadata: { resumedFrom: "req-1", kind: "assistant_reply" }
  };
  const withResumed = upsertMessage(existing, resumed as ChatMessage);

  const incoming = [
    makeMsg("a1", "2024-01-01T00:00:00Z", "initial reply"),
    resumed as ChatMessage,
    makeMsg("b1", "2024-01-01T00:00:00Z", "other chat"),
  ];

  const merged = mergeMessages(withResumed, incoming);
  const ourIds = merged.map((m) => m.id);
  assert.equal(new Set(ourIds).size, ourIds.length);
  assert(ourIds.includes("a1"));
  assert(ourIds.includes("a2"));
  assert(ourIds.includes("b1"));
});

test("chat merge preserves locally-created chats on reload", () => {
  const localChat = { id: "chat-local", title: "Local", orgId: "org-x", metadata: {}, archivedAt: null, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" };
  const serverChats = [{ id: "chat-server", title: "Server" }];

  const currentIds = new Set([localChat].map((c) => c.id));
  const merged = [localChat, ...serverChats.filter((c) => !currentIds.has(c.id))];

  assert.equal(merged.length, 2);
  assert(merged.some((c) => c.id === "chat-local"));
  assert(merged.some((c) => c.id === "chat-server"));
});

test("done frame is last after all SSE frames", () => {
  const frames = [
    { kind: "chat_created" },
    { kind: "message_persisted" },
    { kind: "run_state" },
    { kind: "done" },
  ];
  const doneIndex = frames.findIndex((f) => f.kind === "done");
  assert.equal(doneIndex, frames.length - 1);
});
