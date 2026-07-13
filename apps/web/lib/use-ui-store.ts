"use client";

import { createContext, createElement, useContext, useMemo, useState, type ReactNode } from "react";
import { SIDEBAR } from "@spielos/design-system";

export type UiStore = {
  inspectorOpen: boolean;
  inspectorWidth: number;
  setInspectorOpen: (open: boolean) => void;
  setInspectorWidth: (width: number) => void;
  toggleInspector: () => void;
};

const UiStoreContext = createContext<UiStore | null>(null);

export function UiStoreProvider({ children }: { children: ReactNode }) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorWidth, setInspectorWidthState] = useState<number>(SIDEBAR.INSPECTOR.DEFAULT);

  const store = useMemo<UiStore>(
    () => ({
      inspectorOpen,
      inspectorWidth,
      setInspectorOpen,
      setInspectorWidth: (width: number) => {
        setInspectorWidthState(
          Math.min(SIDEBAR.INSPECTOR.MAX, Math.max(SIDEBAR.INSPECTOR.MIN, Math.round(width)))
        );
      },
      toggleInspector: () => setInspectorOpen((current) => !current)
    }),
    [inspectorOpen, inspectorWidth]
  );

  return createElement(UiStoreContext.Provider, { value: store }, children);
}

export function useUiStore(): UiStore {
  const store = useContext(UiStoreContext);
  if (!store) throw new Error("useUiStore must be used within a <UiStoreProvider>");
  return store;
}
