"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { AppShell } from "../components/app-shell";
import { useRuntimeStore } from "../lib/runtime-store";

const RunsView = dynamic(() => import("../components/chat/runs-view").then((m) => m.RunsView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <div className="text-sm">Loading run workbench…</div>
    </div>
  )
});

const RunDrawer = dynamic(() => import("../components/chat/run-drawer").then((m) => m.RunDrawer), {
  ssr: false
});

export default function HomePage() {
  useEffect(() => {
    useRuntimeStore.getState().startNewChat();
  }, []);

  return (
    <AppShell inspector={<RunDrawer />}>
      <RunsView />
    </AppShell>
  );
}
