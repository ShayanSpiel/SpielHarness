"use client";

import { Icon } from "../icons";
import { InspectorToggle } from "../inspector-toggle";
import { useEffect, useMemo, useState } from "react";
import { Button, Tooltip } from "@spielos/design-system";
import { ChatThread } from "./chat-thread";
import { RunsModal } from "./runs-modal";
import { useRunContext } from "../../lib/run-context";
import { useWorkspaceStore } from "../../lib/use-workspace-store";

function RunHeader({ onOpenRuns }: { onOpenRuns: () => void }) {
  const run = useRunContext();
  const store = useWorkspaceStore();
  const chat = useMemo(
    () => store.chats.find((entry) => entry.id === store.activeChatId) ?? null,
    [store.chats, store.activeChatId]
  );

  useEffect(() => {
    if (chat) {
      run.setRunTitle(chat.title);
    }
  }, [chat, run]);

  const counts = useMemo(() => {
    const map = { role: 0, tool: 0, library: 0, workstream: 0, strategy: 0, knowledge: 0, eval: 0 };
    for (const item of run.contextItems) map[item.kind] += 1;
    return map;
  }, [run.contextItems]);

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel-raised px-3">
      <Tooltip content="Open runs (⌘⇧O)" side="bottom">
        <Button
          aria-label="Open runs"
          className="gap-1.5 text-xs font-medium text-foreground"
          onClick={onOpenRuns}
          size="sm"
          variant="ghost"
        >
          <Icon name="play" size={14} />
          {run.runTitle}
        </Button>
      </Tooltip>
      <span className="text-[11px] text-muted-foreground">
        {counts.role} roles · {counts.tool} skills · {counts.library} files · {counts.workstream} workstreams
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <InspectorToggle label="Open inspector" />
      </div>
    </header>
  );
}

export function RunsView() {
  const [runsOpen, setRunsOpen] = useState(false);

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <RunHeader onOpenRuns={() => setRunsOpen(true)} />
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatThread />
        </div>
      </div>
      <RunsModal onOpenChange={setRunsOpen} open={runsOpen} />
    </>
  );
}
