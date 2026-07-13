"use client";

import { createElement, type ReactNode } from "react";
import { ChatStoreProvider, useChatStore, type ChatStore } from "./use-chat-store";
import { DomainStoreProvider, useDomainStore, type DomainStore } from "./use-domain-store";
import { UiStoreProvider, useUiStore, type UiStore } from "./use-ui-store";

export type Store = UiStore & ChatStore & DomainStore;

export function WorkspaceStoreProvider({ children }: { children: ReactNode }) {
  return createElement(
    UiStoreProvider,
    null,
    createElement(ChatStoreProvider, null, createElement(DomainStoreProvider, null, children))
  );
}

export function useWorkspaceStore(): Store {
  return { ...useUiStore(), ...useChatStore(), ...useDomainStore() };
}
