"use client";

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../index";
import { SIDEBAR } from "../layout-constants";

export type ResizableSidebarProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  children: ReactNode;
  defaultWidth?: number;
  maxWidth?: number;
  minWidth?: number;
  resizable?: boolean;
  sidebarId: string;
  title: string;
};

export function ResizableSidebar({
  children,
  className,
  defaultWidth = SIDEBAR.LIST.DEFAULT,
  maxWidth = SIDEBAR.LIST.MAX,
  minWidth = SIDEBAR.LIST.MIN,
  resizable = true,
  sidebarId,
  style,
  title,
  ...props
}: ResizableSidebarProps) {
  const storageKey = `spielos.sidebar.${sidebarId}.width`;
  const [panelWidth, setPanelWidth] = useState<number>(defaultWidth);
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const widthRef = useRef(defaultWidth);

  function updateWidth(next: number, persist = true) {
    const bounded = Math.min(maxWidth, Math.max(minWidth, Math.round(next)));
    widthRef.current = bounded;
    setPanelWidth(bounded);
    if (!persist) return;
    try {
      window.localStorage.setItem(storageKey, String(bounded));
    } catch {
      // Resizing still works for this session in hardened browser contexts.
    }
  }

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) updateWidth(saved, false);
    } catch {
      // Use the contract default when browser storage is unavailable.
    }
  // The identity owns persistence; dimension contracts intentionally reset only when the identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: PointerEvent) => {
      const panelLeft = panelRef.current?.getBoundingClientRect().left ?? 0;
      updateWidth(event.clientX - panelLeft, false);
    };
    const onUp = () => {
      setResizing(false);
      updateWidth(widthRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  // Pointer tracking reads live refs; reattaching listeners on every width update causes drag jitter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizing, storageKey]);

  return (
    <aside
      className={cn(
        "relative flex min-w-0 max-w-[var(--sidebar-list-responsive-max)] shrink-0 flex-col overflow-hidden border-r border-border bg-panel lg:max-w-none",
        className
      )}
      ref={panelRef}
      style={{ ...style, width: panelWidth }}
      {...props}
    >
      {children}
      {resizable ? (
        <button
          aria-label={`Resize ${title}`}
          aria-orientation="vertical"
          aria-valuemax={maxWidth}
          aria-valuemin={minWidth}
          aria-valuenow={panelWidth}
          className="group absolute right-0 top-0 z-20 flex h-full w-1.5 cursor-col-resize items-center justify-center transition-colors hover:bg-border-strong/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          onDoubleClick={() => updateWidth(defaultWidth)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") updateWidth(panelWidth - 16);
            else if (event.key === "ArrowRight") updateWidth(panelWidth + 16);
            else if (event.key === "Home") updateWidth(minWidth);
            else if (event.key === "End") updateWidth(maxWidth);
            else return;
            event.preventDefault();
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            setResizing(true);
          }}
          role="separator"
          type="button"
        >
          <span className="h-8 w-0.5 rounded-full bg-border transition-colors group-hover:bg-muted-foreground" />
        </button>
      ) : null}
    </aside>
  );
}
