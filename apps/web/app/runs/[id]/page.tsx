"use client";

import { use, useEffect } from "react";
import dynamic from "next/dynamic";
import { AppShell } from "../../../components/app-shell";
import { useRunContext } from "../../../lib/run-context";
import type { Artifact, RunEvent } from "@spielos/core";

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

type DbRunEvent = {
  id: string;
  org_id: string;
  run_id: string;
  event_type: string;
  node: string | null;
  skill: string | null;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
};

function eventFromDb(row: DbRunEvent) {
  return {
    id: row.id,
    orgId: row.org_id,
    runId: row.run_id,
    type: row.event_type as RunEvent["type"],
    sequence: 0,
    nodeId: row.node ?? undefined,
    skillName: row.skill ?? undefined,
    message: row.message,
    payload: row.payload ?? {},
    createdAt: row.created_at
  };
}

function RunLoader({ runId }: { runId: string }) {
  const run = useRunContext();

  useEffect(() => {
    run.setActiveRunId(runId);
    run.clearArtifacts();
    run.setHumanInputRequest(null);

    fetch(`/api/runs/${runId}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) run.reset();
      })
      .catch(() => run.reset());

    fetch(`/api/runs/${runId}/events`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then((data: { events?: DbRunEvent[] }) => {
        run.clearEvents();
        for (const evt of data.events ?? []) {
          run.appendEvent(eventFromDb(evt));
        }
      })
      .catch(() => run.clearEvents());

    fetch(`/api/runs/${runId}/artifacts`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { artifacts: [] }))
      .then((data: { artifacts?: Artifact[] }) => {
        run.clearArtifacts();
        for (const a of data.artifacts ?? []) {
          run.appendArtifact(a);
        }
      })
      .catch(() => run.clearArtifacts());
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