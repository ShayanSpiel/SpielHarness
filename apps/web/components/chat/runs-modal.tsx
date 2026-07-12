"use client";

import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Dialog, DialogContent, Input, Pill, cn } from "@spielos/design-system";
import { useRunContext } from "../../lib/run-context";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import type { Artifact, RunEvent } from "@spielos/core";

type DbRun = {
  id: string;
  prompt: string;
  status: string;
  run_type: string;
  inputs: {
    target?: { type?: string; id?: string };
    selectedContext?: Array<{ title?: string; kind?: string }>;
    workstreamId?: string;
  };
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type DbRunEvent = {
  id: string;
  org_id: string;
  run_id: string;
  event_type: RunEvent["type"];
  node: string | null;
  skill: string | null;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function eventFromDb(row: DbRunEvent): RunEvent {
  return {
    id: row.id,
    orgId: row.org_id,
    runId: row.run_id,
    type: row.event_type,
    node: row.node ?? undefined,
    skill: row.skill ?? undefined,
    message: row.message,
    payload: row.payload ?? {},
    createdAt: row.created_at
  };
}

function Section({
  title,
  icon,
  children
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-1.5">
      <header className="flex items-center gap-1.5 px-2 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{title}</span>
      </header>
      {children}
    </section>
  );
}

export function RunsModal({
  open: openProp,
  onOpenChange: onOpenChangeProp
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChangeProp?.(next);
  };
  const [query, setQuery] = useState("");
  const [runs, setRuns] = useState<DbRun[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const store = useWorkspaceStore();
  const run = useRunContext();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.shiftKey && (event.key === "o" || event.key === "O")) {
        event.preventDefault();
        setOpen(!open);
      } else if (event.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    setLoading(true);
    fetch("/api/runs", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { runs: [] }))
      .then((data: { runs?: DbRun[] }) => setRuns((data.runs ?? []).slice(0, 10)))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
    return () => clearTimeout(t);
  }, [open]);

  const filteredRuns = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((entry) => {
      const context = entry.inputs?.selectedContext?.map((item) => item.title ?? "").join(" ") ?? "";
      return [entry.prompt, entry.status, entry.run_type, entry.inputs?.target?.type ?? "", context]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [query, runs]);

  function newRun() {
    store.createChat("New run");
    run.setActiveRunId(null);
    run.setRunTitle("New run");
    run.clearContext();
    run.clearEvents();
    run.clearArtifacts();
    run.setHumanInputRequest(null);
    setOpen(false);
  }

  async function openPersistedRun(entry: DbRun) {
    run.setActiveRunId(entry.id);
    run.setRunTitle(entry.prompt.slice(0, 80) || "Run");
    run.clearArtifacts();
    run.setHumanInputRequest(null);
    const response = await fetch(`/api/runs/${entry.id}/events`, { cache: "no-store" });
    if (response.ok) {
      const data = (await response.json()) as { events?: DbRunEvent[] };
      run.replaceEvents((data.events ?? []).map(eventFromDb));
    } else {
      run.clearEvents();
    }
    const artifactResponse = await fetch(`/api/runs/${entry.id}/artifacts`, { cache: "no-store" });
    if (artifactResponse.ok) {
      const data = (await artifactResponse.json()) as { artifacts?: Artifact[] };
      run.replaceArtifacts(data.artifacts ?? []);
    }
    setOpen(false);
  }

  const navEntries = [
    { href: "/", label: "Runs", icon: <Icon name={ENTITY_ICONS.run} size={14} /> },
    { href: "/roles", label: "Roles", icon: <Icon name={ENTITY_ICONS.role} size={14} /> },
    { href: "/workflows", label: "Workflows", icon: <Icon name={ENTITY_ICONS.workflow} size={14} /> },
    { href: "/skills", label: "Skills", icon: <Icon name={ENTITY_ICONS.skill} size={14} /> },
    { href: "/evals", label: "Evals", icon: <Icon name={ENTITY_ICONS.eval} size={14} /> },
    { href: "/knowledge", label: "Knowledge", icon: <Icon name={ENTITY_ICONS.knowledge} size={14} /> },
    { href: "/settings", label: "Settings", icon: <Icon name={ENTITY_ICONS.settings} size={14} /> }
  ];

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className="!top-[12vh] !translate-y-0 flex max-h-[calc(100vh-16vh)] h-[min(72vh,calc(100vh-16vh))] w-[min(680px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-panel p-0 shadow-[var(--shadow-popover)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        hideClose
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Icon name="search" className="text-muted-foreground" size={16} />
          <Input
            ref={inputRef}
            className="h-7 w-full border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search runs and destinations..."
            value={query}
            variant="ghost"
          />
          <div className="text-3xs uppercase tracking-wider text-muted-foreground">
            {loading ? "loading" : `${filteredRuns.length} runs`}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="grid gap-4">
            <Section icon={<Icon name="plus" size={12} />} title="Actions">
              <button
                className="flex w-full items-center gap-2 rounded-md border border-border bg-panel-raised px-2.5 py-2 text-left transition-colors hover:bg-hover"
                onClick={newRun}
                type="button"
              >
                <Icon name="plus" size={14} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-foreground">New Run</div>
                  <div className="text-2xs text-muted-foreground">Clear the workbench and start fresh.</div>
                </div>
              </button>
            </Section>

            <Section icon={<Icon name="compass" size={12} />} title="Navigate">
              <div className="grid grid-cols-2 gap-1">
                {navEntries.map((entry) => (
                  <button
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-hover"
                    key={entry.href}
                    onClick={() => {
                      window.location.href = entry.href;
                      setOpen(false);
                    }}
                    type="button"
                  >
                    <span className="text-muted-foreground">{entry.icon}</span>
                    <span className="truncate">{entry.label}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section icon={<Icon name="history" size={12} />} title="Last 10 Runs">
              {filteredRuns.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  {loading ? "Loading runs..." : "No persisted runs found."}
                </div>
              ) : (
                <ul className="grid gap-1">
                  {filteredRuns.map((entry) => (
                    <li key={entry.id}>
                      <button
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                          run.activeRunId === entry.id
                            ? "border-border-strong bg-selected"
                            : "border-transparent hover:border-border hover:bg-hover"
                        )}
                        onClick={() => void openPersistedRun(entry)}
                        type="button"
                      >
                        <Icon name={entry.status === "completed" ? "check" : entry.status === "failed" ? "x" : "play"} className={`mt-0.5 ${entry.status === "completed" ? "text-success" : entry.status === "failed" ? "text-destructive" : "text-muted-foreground"}`} size={14} />
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-1 text-[13px] font-medium text-foreground">
                            {entry.prompt || "Untitled run"}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-3xs text-muted-foreground">
                            <Pill tone={entry.status === "completed" ? "success" : entry.status === "failed" ? "destructive" : "default"} className="text-3xs">
                              {entry.status}
                            </Pill>
                            <span>{entry.inputs?.target?.type ?? entry.run_type}</span>
                            <span>{formatTime(entry.updated_at ?? entry.created_at)}</span>
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border bg-panel-raised px-4 py-2 text-2xs text-muted-foreground">
          <span>Persisted runs come from the database.</span>
          <Button onClick={newRun} size="sm" type="button" variant="primary">
            <Icon name="plus" size={14} />
            New Run
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
