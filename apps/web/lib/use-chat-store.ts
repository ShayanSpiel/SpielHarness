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
import type { ChatMessage as DbChatMessage } from "@spielos/core";
import { toast } from "@spielos/design-system";
import { fetchJsonWithRetry } from "./fetch-json";


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
};

const ChatStoreContext = createContext<ChatStore | null>(null);

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

  const reload = useCallback(async () => {
    // HttpOnly session cookies are deliberately invisible to client code.
    // Protected routes should load through the authenticated API instead of
    // guessing authentication state from document.cookie.
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
            role: string;
            body: string;
            metadata: Record<string, unknown>;
            created_at: string;
          }>;
        }>;
      }>("/api/chats", { cache: "no-store" });
      const newChats: Chat[] = data.chats.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        archivedAt: c.archived_at
        ,metadata: c.metadata ?? {}
      }));
      const newMessages: Record<string, DbChatMessage[]> = {};
      for (const c of data.chats) {
        newMessages[c.id] = (c.chat_messages ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
          .map((m) => ({
            id: m.id,
            orgId: "",
            chatId: m.chat_id,
            role: m.role as "user" | "assistant" | "system",
            body: m.body,
            metadata: m.metadata ?? {},
            createdAt: m.created_at
          }));
      }
      setChats(newChats);
      setMessages(newMessages);
      if (!initialLoaded.current && newChats.length > 0 && !activeChatId) {
        setActiveChatId(newChats[0].id);
      }
      initialLoaded.current = true;
      loadErrorShown.current = false;
      setReady(true);
    } catch (err) {
      console.error("Failed to load chats:", err);
      if (!loadErrorShown.current) {
        toast.error("Chat history could not be loaded", { description: "SpielOS will retry when the workspace refreshes." });
        loadErrorShown.current = true;
      }
      setReady(true);
    }
  }, [activeChatId]);

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
      setChats((current) => [chat, ...current]);
      setMessages((current) => ({ ...current, [chat.id]: [] }));
      if (activate) setActiveChatId(chat.id);
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
    setChats((current) => current.filter((c) => c.id !== id));
    setMessages((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setActiveChatId((current) => (current === id ? null : current));
  }, []);

  const updateChatMetadata = useCallback(async (id: string, patch: Record<string, unknown>) => {
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

  const store = useMemo<ChatStore>(
    () => ({
      chats,
      activeChatId,
      messages,
      ready,
      setActiveChat: setActiveChatId,
      createChat,
      renameChat,
      archiveChat,
      updateChatMetadata,
      appendMessage,
      hydrateChat,
      reload
    }),
    [chats, activeChatId, messages, ready, createChat, renameChat, archiveChat, updateChatMetadata, appendMessage, hydrateChat, reload]
  );

  return createElement(ChatStoreContext.Provider, { value: store }, children);
}

export function useChatStore(): ChatStore {
  const store = useContext(ChatStoreContext);
  if (!store) throw new Error("useChatStore must be used within a <ChatStoreProvider>");
  return store;
}
