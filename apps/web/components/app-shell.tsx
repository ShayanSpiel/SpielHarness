"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CommandPalette } from "./command-palette";
import { NavRail } from "./nav-rail";
import { InspectorToggle } from "./inspector-toggle";
import { useWorkspaceStore } from "../lib/use-workspace-store";

export function AppShell({
  children,
  inspector
}: {
  children: ReactNode;
  inspector?: ReactNode;
}) {
  const store = useWorkspaceStore();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [resizing, setResizing] = useState(false);
  const asideRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="flex h-screen min-h-screen w-full overflow-hidden bg-background text-foreground">
      <NavRail onOpenSearch={() => setPaletteOpen(true)} />

      <main className="min-w-0 flex-1 overflow-hidden bg-background">{children}</main>

      {hasInspector ? (
        <aside
          ref={asideRef}
          aria-hidden={!store.inspectorOpen}
          data-inspector
          className="relative shrink-0 overflow-hidden border-l border-border bg-panel transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ width: store.inspectorOpen ? store.inspectorWidth : 0 }}
        >
          <button
            aria-label="Resize inspector"
            className="absolute left-0 top-0 z-20 flex h-full w-1.5 cursor-col-resize items-center justify-center text-muted-foreground hover:bg-border-strong/50 hover:text-foreground transition-colors"
            onPointerDown={(event) => {
              event.preventDefault();
              setResizing(true);
            }}
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
        <div className="fixed right-3 top-0 z-50 flex h-10 items-center">
          <InspectorToggle label="Toggle inspector" />
        </div>
      ) : null}
    </div>
  );
}
