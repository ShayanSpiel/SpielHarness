"use client";

import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ActionRow, Dialog, DialogContent, EmptyState, Input, Pill } from "@spielos/design-system";
import { useWorkspaceStore } from "../lib/use-workspace-store";
import { useRunContext } from "../lib/run-context";

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
  { href: "/knowledge", label: "Files", icon: <Icon name={ENTITY_ICONS.knowledge} size={14} />, keywords: ["knowledge", "evidence", "library", "file", "drive"] },
  { href: "/strategy", label: "Strategy", icon: <Icon name={ENTITY_ICONS.strategy} size={14} />, keywords: ["strategy", "prompt", "positioning"] },
  { href: "/roles", label: "Roles", icon: <Icon name={ENTITY_ICONS.role} size={14} />, keywords: ["role", "agent"] },
  { href: "/workflows", label: "Workflows", icon: <Icon name={ENTITY_ICONS.workflow} size={14} />, keywords: ["workflow", "workstream", "graph"] },
  { href: "/skills", label: "Skills", icon: <Icon name={ENTITY_ICONS.skill} size={14} />, keywords: ["skill"] },
  { href: "/evals", label: "Evals", icon: <Icon name={ENTITY_ICONS.eval} size={14} />, keywords: ["eval", "rubric"] },
  { href: "/settings", label: "Settings", icon: <Icon name={ENTITY_ICONS.settings} size={14} />, keywords: ["settings", "integrations", "models"] }
];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function runStatusIcon(status: string): { name: string; className: string } {
  if (status === "completed") return { name: "check-circle", className: "text-success" };
  if (status === "failed") return { name: "x-circle", className: "text-destructive" };
  if (status === "cancelled") return { name: "slash", className: "text-muted-foreground" };
  if (status === "waiting_human") return { name: "clock", className: "text-warning" };
  return { name: "play", className: "text-info" };
}

function runStatusTone(status: string): "default" | "success" | "warning" | "destructive" | "info" {
  if (status === "completed") return "success";
  if (status === "failed") return "destructive";
  if (status === "cancelled") return "default";
  if (status === "waiting_human") return "warning";
  if (status === "running") return "info";
  return "default";
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
  const router = useRouter();
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
    run.reset();
    store.setActiveChat(null);
    router.push("/");
    setOpen(false);
  }

  function openRun(entry: DbRun) {
    window.location.href = `/runs/${entry.id}`;
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
      const statusIcon = runStatusIcon(entry.status);
      list.push({
        id: `run-${entry.id}`,
        label: entry.prompt || "Untitled run",
        group: "Last Runs",
        icon: <Icon name={statusIcon.name} className={statusIcon.className} size={14} />,
        hint: `${entry.run_type} · ${timeAgo(entry.created_at)}`,
        keywords: [entry.prompt.toLowerCase(), entry.status, entry.run_type, entry.inputs?.target?.type ?? ""],
        onSelect: () => void openRun(entry)
      });
    });

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs]);

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
        hideClose
        layout="command"
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
            <EmptyState icon={<Icon name="search" size={16} />} title="No matches" />
          ) : (
            <div className="flex flex-col gap-1.5">
              {groups.map(([group, list]) => (
                <section className="flex flex-col gap-px" key={group}>
                  <header className="flex items-center gap-1.5 px-2 pb-0.5 pt-0.5 text-3xs uppercase tracking-wider text-muted-foreground">
                    <span>{group}</span>
                    {group === "Last Runs" ? <Pill className="ml-auto text-3xs">{list.length}</Pill> : null}
                  </header>
                  <ul className="flex flex-col gap-px">
                    {list.map((entry) => {
                      const idx = visibleIndex++;
                      const selected = idx === active;
                      const isRun = entry.group === "Last Runs";
                      const run = isRun ? runs.find((r) => `run-${r.id}` === entry.id) : null;
                      return (
                        <li key={entry.id}>
                          <ActionRow
                            active={selected}
                            compact={isRun}
                            leading={entry.icon}
                            onClick={() => entry.onSelect()}
                            onMouseEnter={() => setActive(idx)}
                            title={entry.label}
                            trailing={
                              isRun && run ? (
                                <Pill tone={runStatusTone(run.status)} className="text-3xs capitalize">{run.status.replace("_", " ")}</Pill>
                              ) : entry.hint ? (
                                <span className="text-3xs text-muted-foreground">{entry.hint}</span>
                              ) : null
                            }
                          />
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