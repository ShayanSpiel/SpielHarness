"use client";

import { createElement, useMemo, type ReactNode } from "react";
import { useRuntimeStore, type Chat } from "./runtime-store";
import { DomainStoreProvider, useDomainStore, type DomainStore } from "./use-domain-store";
import { UiStoreProvider, useUiStore, type UiStore } from "./use-ui-store";
import { WorkspaceProvider, useWorkspace, type WorkspaceInfo } from "./workspace-context";
import type { ChatMessage, Chat as CoreChat } from "@spielos/core";

type ChatStoreShim = {
  chats: Chat[];
  activeChatId: string | null;
  messages: Record<string, ChatMessage[]>;
  ready: boolean;
  setActiveChat: (id: string | null) => void;
  createChat: (title?: string, activate?: boolean) => Promise<Chat>;
  renameChat: (id: string, title: string) => Promise<void>;
  archiveChat: (id: string) => Promise<void>;
  updateChatMetadata: (id: string, patch: Record<string, unknown>) => Promise<void>;
  appendMessage: (chatId: string, message: { role: "user" | "assistant" | "system"; body: string }) => Promise<ChatMessage>;
  hydrateChat: (chatId: string, value: { messages: ChatMessage[]; metadata?: Record<string, unknown> }) => void;
  reload: () => Promise<void>;
  fetchChatMessages: (chatId: string) => Promise<void>;
  upsertMessage: (chatId: string, msg: ChatMessage) => void;
  upsertChat: (chat: CoreChat) => void;
};

export type Store = UiStore & ChatStoreShim & DomainStore;

export function WorkspaceStoreProvider({ children }: { children: ReactNode }) {
  return createElement(
    WorkspaceProvider,
    null,
    createElement(
      UiStoreProvider,
      null,
      createElement(DomainStoreProvider, null, children)
    )
  );
}

export function useWorkspaceStore(): Store {
  const ui = useUiStore();
  const domain = useDomainStore();
  const runtime = useRuntimeStore();

  const chatShim = useMemo<ChatStoreShim>(
    () => ({
      chats: runtime.chats,
      activeChatId: runtime.activeChatId,
      messages: runtime.messages,
      ready: runtime.ready,
      setActiveChat: runtime.setActiveChat,
      createChat: runtime.createChat,
      renameChat: runtime.renameChat,
      archiveChat: runtime.archiveChat,
      updateChatMetadata: runtime.updateChatMetadata,
      appendMessage: runtime.appendMessage,
      hydrateChat: runtime.hydrateChat,
      reload: runtime.reloadChats,
      fetchChatMessages: runtime.fetchChatMessages,
      upsertMessage: runtime.upsertMessage,
      upsertChat: runtime.upsertChat,
    }),
    [runtime]
  );

  return useMemo(() => ({ ...ui, ...chatShim, ...domain }), [ui, chatShim, domain]);
}

export { useWorkspace, type WorkspaceInfo };
