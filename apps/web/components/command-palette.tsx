"use client";

import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, Input, Pill, cn } from "@spielos/design-system";
import { useWorkspaceStore } from "../lib/use-workspace-store";
import { useRunContext } from "../lib/run-context";
import type { Artifact, RunEvent } from "@spielos/core";

type Group = "Actions" | "Navigate" | "Last Runs";

type DbRun = {
  id: string;
  prompt: string;
  status: string;
  run_type: string;
  inputs: { target?: { type?: string } };
  updated_at: string;
  created_at: string;
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

type Entry = {
  id: string;
  label: string;
  group: Group;
  icon: ReactNode;
  hint?: string;
  onSelect: () => void;
  keywords?: string[];
};

const NAV: { href: string; label: string; icon: ReactNode; keywords: string[] }[] = [
  { href: "/", label: "Runs", icon: <Icon name={ENTITY_ICONS.run} size={14} />, keywords: ["run", "chat", "home"] },
  { href: "/knowledge", label: "Knowledge", icon: <Icon name={ENTITY_ICONS.knowledge} size={14} />, keywords: ["knowledge", "evidence", "library", "file"] },
  { href: "/roles", label: "Roles", icon: <Icon name={ENTITY_ICONS.role} size={14} />, keywords: ["role", "agent"] },
  { href: "/workflows", label: "Workflows", icon: <Icon name={ENTITY_ICONS.workflow} size={14} />, keywords: ["workflow", "workstream", "graph"] },
  { href: "/skills", label: "Skills", icon: <Icon name={ENTITY_ICONS.skill} size={14} />, keywords: ["skill"] },
  { href: "/evals", label: "Evals", icon: <Icon name={ENTITY_ICONS.eval} size={14} />, keywords: ["eval", "rubric"] },
  { href: "/settings", label: "Settings", icon: <Icon name={ENTITY_ICONS.settings} size={14} />, keywords: ["settings", "integrations", "models"] }
];

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

export function CommandPalette({
  open,
  setOpen
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const store = useWorkspaceStore();
  const run = useRunContext();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [runs, setRuns] = useState<DbRun[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      fetch("/api/runs", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : { runs: [] }))
        .then((data: { runs?: DbRun[] }) => setRuns((data.runs ?? []).slice(0, 10)))
        .catch(() => setRuns([]));
      return () => clearTimeout(t);
    }
    setQuery("");
    setActive(0);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function newRun() {
    store.createChat("New run");
    run.setActiveRunId(null);
    run.setRunTitle("New run");
    run.clearContext();
    run.clearEvents();
    run.clearArtifacts();
    run.setHumanInputRequest(null);
    window.location.href = "/";
    setOpen(false);
  }

  async function openRun(entry: DbRun) {
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
    window.location.href = "/";
    setOpen(false);
  }

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [
      {
        id: "act-new-run",
        label: "New Run",
        group: "Actions",
        icon: <Icon name="plus" size={14} />,
        hint: "Clear the workbench",
        keywords: ["new", "run", "chat", "start"],
        onSelect: newRun
      }
    ];

    NAV.forEach((entry) => {
      list.push({
        id: `nav-${entry.href}`,
        label: entry.label,
        group: "Navigate",
        icon: entry.icon,
        hint: entry.href,
        keywords: entry.keywords,
        onSelect: () => {
          window.location.href = entry.href;
          setOpen(false);
        }
      });
    });

    runs.forEach((entry) => {
      list.push({
        id: `run-${entry.id}`,
        label: entry.prompt || "Untitled run",
        group: "Last Runs",
        icon: <Icon name={entry.status === "completed" ? "check" : entry.status === "failed" ? "x" : "play"} className={entry.status === "completed" ? "text-success" : entry.status === "failed" ? "text-destructive" : ""} size={14} />,
        hint: `${entry.status} · ${entry.inputs?.target?.type ?? entry.run_type}`,
        keywords: [entry.prompt.toLowerCase(), entry.status, entry.run_type, entry.inputs?.target?.type ?? ""],
        onSelect: () => void openRun(entry)
      });
    });

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, setOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) => {
      if (entry.label.toLowerCase().includes(q)) return true;
      if (entry.hint?.toLowerCase().includes(q)) return true;
      return entry.keywords?.some((kw) => kw.includes(q)) ?? false;
    });
  }, [entries, query]);

  const groups = useMemo(() => {
    const map = new Map<Group, Entry[]>();
    for (const entry of filtered) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      filtered[active]?.onSelect();
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  let visibleIndex = 0;

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent
        aria-describedby={undefined}
        className="!top-[12vh] !translate-y-0 flex max-h-[calc(100vh-16vh)] h-[min(72vh,calc(100vh-16vh))] w-[min(680px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-panel p-0 shadow-[var(--shadow-popover)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        hideClose
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Icon name="search" size={16} className="text-muted-foreground" />
          <Input
            ref={inputRef}
            className="h-7 w-full border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search actions, pages, and recent runs..."
            value={query}
            variant="ghost"
          />
          <div className="text-3xs uppercase tracking-wider text-muted-foreground">
            {filtered.length} results
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-muted-foreground">
              <Icon name="search" size={16} />
              <div className="text-xs">No matches</div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map(([group, list]) => (
                <section className="flex flex-col gap-0.5" key={group}>
                  <header className="flex items-center gap-1.5 px-2 pb-1 pt-1 text-3xs uppercase tracking-wider text-muted-foreground">
                    <span>{group}</span>
                    {group === "Last Runs" ? <Pill className="ml-auto text-3xs">{list.length}</Pill> : null}
                  </header>
                  <ul className="flex flex-col gap-0.5">
                    {list.map((entry) => {
                      const idx = visibleIndex++;
                      const selected = idx === active;
                      return (
                        <li key={entry.id}>
                          <button
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                              selected ? "bg-selected text-foreground" : "text-foreground hover:bg-hover"
                            )}
                            onClick={() => entry.onSelect()}
                            onMouseEnter={() => setActive(idx)}
                            type="button"
                          >
                            <span className="text-muted-foreground">{entry.icon}</span>
                            <span className="flex-1 truncate text-[13px]">{entry.label}</span>
                            {entry.hint ? (
                              <span className="shrink-0 text-3xs text-muted-foreground">{entry.hint}</span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-panel-raised px-4 py-2 text-2xs text-muted-foreground">
          <span>
            <kbd className="rounded border border-border bg-panel px-1 font-mono">↑↓</kbd> navigate
            <span className="mx-2">·</span>
            <kbd className="rounded border border-border bg-panel px-1 font-mono">↵</kbd> open
          </span>
          <span>
            <kbd className="rounded border border-border bg-panel px-1 font-mono">⌘K</kbd>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
