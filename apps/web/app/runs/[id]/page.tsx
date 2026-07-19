"use client";

import { use, useEffect } from "react";
import dynamic from "next/dynamic";
import { AppShell } from "../../../components/app-shell";
import { useRunContext } from "../../../lib/run-context";
import { useWorkspaceStore } from "../../../lib/use-workspace-store";

const RunsView = dynamic(() => import("../../../components/chat/runs-view").then((m) => m.RunsView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <div className="text-sm">Loading run workbench…</div>
    </div>
  )
});

const RunDrawer = dynamic(() => import("../../../components/chat/run-drawer").then((m) => m.RunDrawer), {
  ssr: false
});

function RunLoader({ runId }: { runId: string }) {
  const run = useRunContext();
  const store = useWorkspaceStore();

  useEffect(() => {
    run.setActiveRunId(runId);
    fetch(`/api/runs/${runId}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        const payload = await res.json() as { run: { chat_id: string | null } };
        if (payload?.run.chat_id) store.setActiveChat(payload.run.chat_id);
      })
      .catch(() => { /* chat-thread.tsx restore() handles failures */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return (
    <AppShell inspector={<RunDrawer />}>
      <RunsView />
    </AppShell>
  );
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const resolved = use(params);
  return <RunLoader runId={resolved.id} />;
}
