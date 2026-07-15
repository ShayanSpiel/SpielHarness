"use client";

import { PageHeader } from "@spielos/design-system";
import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { useEffect, useState } from "react";
import { ChatThread } from "./chat-thread";
import { useRunContext } from "../../lib/run-context";
import { useWorkspaceStore } from "../../lib/use-workspace-store";

function RunHeader() {
  const run = useRunContext();
  const store = useWorkspaceStore();
  const chat = store.chats.find((c) => c.id === store.activeChatId) ?? null;
  const [title, setTitle] = useState(chat?.title ?? "New run");

  useEffect(() => {
    if (chat) setTitle(chat.title);
  }, [chat]);

  return (
    <PageHeader
      icon={<Icon name={ENTITY_ICONS.run} size={14} />}
      title={title}
    >
      <span className="text-2xs text-muted-foreground">
        {run.contextItems.length} attached
        {run.events.length > 0 ? ` · ${run.events.length} events` : ""}
        {run.artifacts.length > 0 ? ` · ${run.artifacts.length} artifacts` : ""}
      </span>
    </PageHeader>
  );
}

export function RunsView() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <RunHeader />
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatThread />
      </div>
    </div>
  );
}