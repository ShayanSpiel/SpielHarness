"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { messageRowToChatMessage, upsertMessage as mergeMessage, mergeMessages, reconcileChats, type ChatMessage as DbChatMessage, type Chat as CoreChat } from "@spielos/core";
import { toast } from "@spielos/design-system";
import { fetchJsonWithRetry } from "./fetch-json";
import { useRealtimeSubscription } from "./use-realtime";
import type { DomainEvent } from "./realtime";


export type Chat = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  metadata: Record<string, unknown>;
};

export type ChatStore = {
  chats: Chat[];
  activeChatId: string | null;
  messages: Record<string, DbChatMessage[]>;
  ready: boolean;
  setActiveChat: (id: string | null) => void;
  createChat: (title?: string, activate?: boolean) => Promise<Chat>;
  renameChat: (id: string, title: string) => Promise<void>;
  archiveChat: (id: string) => Promise<void>;
  updateChatMetadata: (id: string, patch: Record<string, unknown>) => Promise<void>;
  appendMessage: (chatId: string, message: { role: "user" | "assistant" | "system"; body: string }) => Promise<DbChatMessage>;
  hydrateChat: (chatId: string, value: { messages: DbChatMessage[]; metadata?: Record<string, unknown> }) => void;
  reload: () => Promise<void>;
  upsertMessage: (chatId: string, msg: DbChatMessage) => void;
  upsertChat: (chat: CoreChat) => void;
};

const ChatStoreContext = createContext<ChatStore | null>(null);
const ACTIVE_CHAT_STORAGE_KEY = "spielos.activeChatId";

function nowIso() {
  return new Date().toISOString();
}

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Record<string, DbChatMessage[]>>({});
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const initialLoaded = useRef(false);
  const loadErrorShown = useRef(false);
  const reloadRef = useRef<(() => Promise<void>) | null>(null);
  const chatVersionsRef = useRef<Map<string, number>>(new Map());
  const reloadSeqRef = useRef(0);
  const chatsRef = useRef<Chat[]>([]);

  // Phase 4: org-scoped realtime. Any run status change fans out to
  // every chat in the workspace so the active-run pointer and the
  // waiting_human badges stay in sync without polling.
  const orgCookie = typeof document === "undefined" ? null : document.cookie
    .split("; ")
    .find((row) => row.startsWith("spielos.org="))
    ?.split("=")[1] ?? null;
  const realtimeListener = useCallback((event: DomainEvent) => {
    if (event.type === "run.event.appended" || event.type === "run.usage.updated" || event.type === "run.status.changed") {
      window.dispatchEvent(new CustomEvent("spielos:run-update", { detail: event }));
    }
    if (event.type === "run.status.changed" || event.type === "context.invalidated") {
      void reloadRef.current?.();
    }
  }, []);
  useRealtimeSubscription(orgCookie ? `org:${orgCookie}` : null, orgCookie, realtimeListener);

  const reload = useCallback(async () => {
    reloadRef.current = reload;
    const seq = ++reloadSeqRef.current;
    const preFetchVersions = new Map(chatVersionsRef.current);
    if (typeof window !== "undefined" && window.location.pathname === "/login") {
      setReady(true);
      return;
    }
    try {
      const data = await fetchJsonWithRetry<{
        chats: Array<{
          id: string;
          title: string;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
          metadata: Record<string, unknown>;
          chat_messages: Array<{
            id: string;
            chat_id: string;
            org_id: string;
            role: string;
            body: string;
            metadata: Record<string, unknown>;
            created_at: string;
          }>;
        }>;
      }>("/api/chats", { cache: "no-store" });
      if (seq !== reloadSeqRef.current) return;
      const newChats: Chat[] = data.chats.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        archivedAt: c.archived_at,
        metadata: c.metadata ?? {}
      }));
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
      setMessages((prev) => {
        const next = { ...prev };
        for (const [cid, incoming] of Object.entries(newMessages)) {
          next[cid] = mergeMessages(prev[cid] ?? [], incoming);
        }
        return next;
      });
      const isRoot = typeof window !== "undefined" && window.location.pathname === "/";
      const storedActiveChatId = typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY) : null;
      setActiveChatId((current) => {
        if (isRoot) return null;
        const candidate = current ?? storedActiveChatId;
        const latest = chatsRef.current;
        return candidate && latest.some((chat) => chat.id === candidate) ? candidate : null;
      });
      initialLoaded.current = true;
      loadErrorShown.current = false;
      setReady(true);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to load chats:", err);
      }
      if (!loadErrorShown.current) {
        toast.error("Chat history could not be loaded", { description: "SpielOS will retry when the workspace refreshes." });
        loadErrorShown.current = true;
      }
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const handler = () => void reload();
    window.addEventListener("spielos:workspace-reload", handler);
    return () => window.removeEventListener("spielos:workspace-reload", handler);
  }, [reload]);

  const createChat = useCallback(
    async (title = "New chat", activate = true) => {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      if (!res.ok) throw new Error("Failed to create chat");
      const data = (await res.json()) as { chat: { id: string; title: string; metadata: Record<string, unknown>; created_at: string; updated_at: string; archived_at: string | null } };
      const chat: Chat = {
        id: data.chat.id,
        title: data.chat.title,
        createdAt: data.chat.created_at,
        updatedAt: data.chat.updated_at,
        archivedAt: data.chat.archived_at
        ,metadata: data.chat.metadata ?? {}
      };
      chatVersionsRef.current.set(chat.id, (chatVersionsRef.current.get(chat.id) ?? 0) + 1);
      setChats((current) => [chat, ...current]);
      setMessages((current) => ({ ...current, [chat.id]: [] }));
      if (activate) {
        setActiveChatId(chat.id);
        window.localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, chat.id);
      }
      return chat;
    },
    []
  );

  const renameChat = useCallback(async (id: string, title: string) => {
    const res = await fetch("/api/chats", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title })
    });
    if (!res.ok) return;
    chatVersionsRef.current.set(id, (chatVersionsRef.current.get(id) ?? 0) + 1);
    setChats((current) =>
      current.map((c) => (c.id === id ? { ...c, title, updatedAt: nowIso() } : c))
    );
  }, []);

  const archiveChat = useCallback(async (id: string) => {
    const res = await fetch("/api/chats", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, archived: true })
    });
    if (!res.ok) return;
    chatVersionsRef.current.set(id, (chatVersionsRef.current.get(id) ?? 0) + 1);
    setChats((current) => current.filter((c) => c.id !== id));
    setMessages((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setActiveChatId((current) => {
      if (current !== id) return current;
      window.localStorage.removeItem(ACTIVE_CHAT_STORAGE_KEY);
      return null;
    });
  }, []);

  const updateChatMetadata = useCallback(async (id: string, patch: Record<string, unknown>) => {
    chatVersionsRef.current.set(id, (chatVersionsRef.current.get(id) ?? 0) + 1);
    setChats((current) => current.map((chat) => chat.id === id
      ? { ...chat, metadata: { ...chat.metadata, ...patch }, updatedAt: nowIso() }
      : chat));
    const res = await fetch("/api/chats", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, metadata: patch })
    });
    if (!res.ok) {
      await reload();
      throw new Error("Failed to save chat context");
    }
  }, [reload]);

  const appendMessage = useCallback(
    async (chatId: string, message: { role: "user" | "assistant" | "system"; body: string }) => {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message)
      });
      if (!res.ok) throw new Error("Failed to append message");
      const data = (await res.json()) as { message: DbChatMessage };
      setMessages((current) => ({
        ...current,
        [chatId]: [...(current[chatId] ?? []), data.message]
      }));
      return data.message;
    },
    []
  );

  const hydrateChat = useCallback((chatId: string, value: { messages: DbChatMessage[]; metadata?: Record<string, unknown> }) => {
    setMessages((current) => ({ ...current, [chatId]: value.messages }));
    if (value.metadata) {
      setChats((current) => current.map((chat) => chat.id === chatId
        ? { ...chat, metadata: { ...chat.metadata, ...value.metadata }, updatedAt: nowIso() }
        : chat));
    }
  }, []);

  const upsertMessage = useCallback((chatId: string, msg: DbChatMessage) => {
    setMessages((prev) => ({
      ...prev,
      [chatId]: mergeMessage(prev[chatId] ?? [], msg)
    }));
  }, []);

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

  const store = useMemo<ChatStore>(
    () => ({
      chats,
      activeChatId,
      messages,
      ready,
      setActiveChat: (id) => {
        setActiveChatId(id);
        if (id) window.localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, id);
        else window.localStorage.removeItem(ACTIVE_CHAT_STORAGE_KEY);
      },
      createChat,
      renameChat,
      archiveChat,
      updateChatMetadata,
      appendMessage,
      hydrateChat,
      reload,
      upsertMessage,
      upsertChat
    }),
    [chats, activeChatId, messages, ready, createChat, renameChat, archiveChat, updateChatMetadata, appendMessage, hydrateChat, reload, upsertMessage, upsertChat]
  );

  return createElement(ChatStoreContext.Provider, { value: store }, children);
}

export function useChatStore(): ChatStore {
  const store = useContext(ChatStoreContext);
  if (!store) throw new Error("useChatStore must be used within a <ChatStoreProvider>");
  return store;
}
