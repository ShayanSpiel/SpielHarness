"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CommandPalette } from "./command-palette";
import { NavRail } from "./nav-rail";
import { InspectorToggle } from "./inspector-toggle";
import { useUiStore } from "../lib/use-ui-store";
import { SIDEBAR } from "@spielos/design-system";

export function AppShell({
  children,
  inspector
}: {
  children: ReactNode;
  inspector?: ReactNode;
}) {
  const store = useUiStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [resizing, setResizing] = useState(false);
  const asideRef = useRef<HTMLDivElement>(null);
  const inspectorInitialized = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: PointerEvent) => {
      const newWidth = window.innerWidth - event.clientX;
      store.setInspectorWidth(newWidth);
    };
    const onUp = () => setResizing(false);
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
  }, [resizing, store]);

  const hasInspector = Boolean(inspector);

  useEffect(() => {
    if (!hasInspector || inspectorInitialized.current) return;
    inspectorInitialized.current = true;
    if (window.matchMedia("(min-width: 1024px)").matches) store.setInspectorOpen(true);
  }, [hasInspector, store]);

  return (
    <div className="flex h-screen min-h-screen w-full overflow-hidden bg-background text-foreground">
      <NavRail onOpenSearch={() => setPaletteOpen(true)} />

      <main className="min-w-0 flex-1 overflow-hidden bg-background">{children}</main>

      {hasInspector ? (
        <button
          aria-label="Close inspector"
          aria-hidden={!store.inspectorOpen}
          className="motion-overlay fixed inset-0 z-30 bg-overlay backdrop-blur-sm data-[state=closed]:pointer-events-none lg:hidden"
          data-state={store.inspectorOpen ? "open" : "closed"}
          onClick={() => store.setInspectorOpen(false)}
          tabIndex={store.inspectorOpen ? 0 : -1}
          type="button"
        />
      ) : null}

      {hasInspector ? (
        <aside
          ref={asideRef}
          aria-hidden={!store.inspectorOpen}
          data-inspector
          className="fixed inset-y-0 end-0 z-40 max-w-full shrink-0 overflow-hidden border-s border-border bg-panel shadow-popover transition-[width] duration-[var(--duration-slow)] ease-[var(--ease)] lg:relative lg:z-auto lg:shadow-none"
          style={{ width: store.inspectorOpen ? store.inspectorWidth : 0 }}
        >
          <button
            aria-label="Resize inspector"
            aria-orientation="vertical"
            aria-valuemax={SIDEBAR.INSPECTOR.MAX}
            aria-valuemin={SIDEBAR.INSPECTOR.MIN}
            aria-valuenow={store.inspectorWidth}
            className="group absolute start-0 top-0 z-20 hidden h-full w-1.5 cursor-col-resize items-center justify-center text-muted-foreground transition-colors hover:bg-border-strong/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] lg:flex"
            onDoubleClick={() => store.setInspectorWidth(SIDEBAR.INSPECTOR.DEFAULT)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") store.setInspectorWidth(store.inspectorWidth + 16);
              else if (event.key === "ArrowRight") store.setInspectorWidth(store.inspectorWidth - 16);
              else if (event.key === "Home") store.setInspectorWidth(SIDEBAR.INSPECTOR.MIN);
              else if (event.key === "End") store.setInspectorWidth(SIDEBAR.INSPECTOR.MAX);
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
            <div className="h-8 w-0.5 rounded-full bg-border transition-colors group-hover:bg-muted-foreground" />
          </button>
          <div
            className="flex h-full flex-col"
            style={{
              visibility: store.inspectorOpen ? "visible" : "hidden",
              pointerEvents: store.inspectorOpen ? "auto" : "none"
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto">{inspector}</div>
          </div>
        </aside>
      ) : null}

      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />

      {hasInspector ? (
        <div className="fixed end-3 top-0 z-50 flex h-10 items-center">
          <InspectorToggle label="Toggle inspector" />
        </div>
      ) : null}
    </div>
  );
}
