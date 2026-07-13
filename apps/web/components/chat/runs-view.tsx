"use client";

import { Button, Tooltip } from "@spielos/design-system";
import { useEffect, useState } from "react";
import { ChatThread } from "./chat-thread";
import { RunsModal } from "./runs-modal";
import { useRunContext } from "../../lib/run-context";
import { useWorkspaceStore } from "../../lib/use-workspace-store";

function RunHeader({ onOpenRuns }: { onOpenRuns: () => void }) {
  const run = useRunContext();
  const store = useWorkspaceStore();
  const chat = store.chats.find((c) => c.id === store.activeChatId) ?? null;
  const [title, setTitle] = useState(chat?.title ?? "New run");

  useEffect(() => {
    if (chat) setTitle(chat.title);
  }, [chat]);

  const counts: Record<string, number> = {};
  for (const item of run.contextItems) counts[item.kind] = (counts[item.kind] ?? 0) + 1;

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <Tooltip content="Open runs (⌘⇧O)" side="bottom">
        <Button aria-label="Open runs" onClick={onOpenRuns} size="sm" variant="ghost" icon="play">
          {title}
        </Button>
      </Tooltip>
      <span className="text-2xs text-muted-foreground">
        {run.contextItems.length} attached
        {run.events.length > 0 ? ` · ${run.events.length} events` : ""}
        {run.artifacts.length > 0 ? ` · ${run.artifacts.length} artifacts` : ""}
      </span>
    </header>
  );
}

export function RunsView() {
  const [runsOpen, setRunsOpen] = useState(false);

  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (event.key === "O" && (event.metaKey || event.ctrlKey) && event.shiftKey) {
        event.preventDefault();
        setRunsOpen((current) => !current);
      }
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <RunHeader onOpenRuns={() => setRunsOpen(true)} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatThread />
      </div>
      <RunsModal onOpenChange={setRunsOpen} open={runsOpen} />
    </div>
  );
}
