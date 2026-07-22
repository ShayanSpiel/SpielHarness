"use client";

import { use, useEffect } from "react";
import dynamic from "next/dynamic";
import { AppShell } from "../../../components/app-shell";
import { useRunContext } from "../../../lib/run-context";
import { useRuntimeStore } from "../../../lib/runtime-store";

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

  useEffect(() => {
    run.setActiveRunId(runId);
    // A route load starts from an unhydrated projection whose local checkpoint
    // version is 0. Passing that as `since=0` can legitimately receive 304 for
    // a newly-created Director run and leave the page looking like a new chat.
    // The URL is an explicit restoration request, so always fetch its complete
    // authoritative snapshot once; later realtime restores remain monotonic.
    void useRuntimeStore.getState().restoreRun(runId, { force: true });
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
