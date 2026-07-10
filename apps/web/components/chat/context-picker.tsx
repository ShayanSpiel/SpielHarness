"use client";

import { Icon } from "../icons";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { Button, Dialog, DialogContent, Input, cn } from "@spielos/design-system";
import { useRunContext, type ContextItem, type ContextItemKind } from "../../lib/run-context";
import { useWorkspaceStore } from "../../lib/use-workspace-store";

type Section = {
  id: ContextItemKind;
  label: string;
  icon: ReactNode;
  blurb: string;
};

const SECTIONS: Section[] = [
  { id: "role", label: "Roles", icon: <Icon name="users" size={14} />, blurb: "Agents that will collaborate" },
  { id: "tool", label: "Skills", icon: <Icon name="sparkles" size={14} />, blurb: "Callable capabilities the team can use" },
  { id: "workstream", label: "Workstreams", icon: <Icon name="folder-kanban" size={14} />, blurb: "Multi-step graphs" },
  { id: "eval", label: "Evals", icon: <Icon name="bar-chart" size={14} />, blurb: "Rubrics for scoring content, prompts, and workflows" },
  { id: "knowledge", label: "Knowledge Base", icon: <Icon name="brain" size={14} />, blurb: "Strategy, files, and evidence" },
];

type Candidate = {
  id: string;
  kind: ContextItemKind;
  title: string;
  subtitle?: string;
  body?: string;
  meta?: Record<string, string>;
};

export function ContextPicker() {
  const run = useRunContext();
  const store = useWorkspaceStore();
  const [active, setActive] = useState<ContextItemKind>("role");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (run.pickerOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    setQuery("");
  }, [run.pickerOpen]);

  const candidates = useMemo<Candidate[]>(() => {
    switch (active) {
      case "role":
        return store.roles.map((role) => ({
          id: role.id,
          kind: "role",
          title: role.name,
          subtitle: role.description?.slice(0, 80),
          body: role.prompt
        }));
      case "tool":
        return store.skills.map((skill) => ({
          id: skill.id,
          kind: "tool" as const,
          title: skill.name,
          subtitle: `${skill.slug} · ${skill.sideEffect}`,
          body: skill.description,
          meta: { slug: skill.slug, category: skill.category }
        }));
      case "eval":
        return store.evalFiles.map((evalFile) => ({
          id: evalFile.id,
          kind: "eval" as const,
          title: evalFile.name,
          subtitle: `${evalFile.targetType} · ${evalFile.rubrics.length} rubrics · threshold ${evalFile.overallThreshold}`,
          body: evalFile.description,
          meta: { targetType: evalFile.targetType, targetId: evalFile.targetId }
        }));
      case "workstream":
        return store.workstreams.map((workstream) => ({
          id: workstream.id,
          kind: "workstream" as const,
          title: workstream.title,
          subtitle: `${workstream.nodes.length} steps · ${workstream.edges.length} edges`,
          body: workstream.description
        }));
      case "knowledge":
        return store.items
          .filter((item) => ["strategy", "knowledge", "library"].includes(item.kind))
          .map((item) => ({
            id: item.id,
            kind: "knowledge" as const,
            title: item.title,
            subtitle: item.folder ?? item.kind,
            body: item.body
          }));
      default:
        return [];
    }
  }, [active, store.items, store.roles, store.skills, store.workstreams, store.evalFiles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((entry) => {
      return (
        entry.title.toLowerCase().includes(q) ||
        (entry.subtitle?.toLowerCase().includes(q) ?? false) ||
        (entry.body?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [candidates, query]);

  const selectedIds = new Set(run.contextItems.map((entry) => entry.id));

  function conflictReason(candidate: Candidate) {
    const normalizedKind = candidate.kind === "tool" ? "skill" : candidate.kind === "workstream" ? "workflow" : candidate.kind;
    const executable = run.contextItems.map((item) =>
      item.kind === "tool" ? "skill" : item.kind === "workstream" ? "workflow" : item.kind
    );
    const hasWorkflow = executable.includes("workflow");
    const hasRole = executable.includes("role");
    const hasSkill = executable.includes("skill");
    const hasEval = executable.includes("eval");

    if (normalizedKind === "workflow" && (hasWorkflow || hasRole || hasSkill || hasEval)) {
      return "Workflows run by themselves. Remove other executable targets first.";
    }
    if (hasWorkflow && ["role", "skill", "eval"].includes(normalizedKind)) {
      return "A workflow already controls its roles and skills.";
    }
    if (normalizedKind === "role" && hasRole) return "Only one role can be selected.";
    if (normalizedKind === "skill" && hasSkill) return "Only one direct skill can be selected.";
    if (normalizedKind === "eval" && (hasEval || hasRole || hasSkill || hasWorkflow)) {
      return "Run an evaluation separately or as a workflow gate.";
    }
    if (hasEval && ["role", "skill", "workflow"].includes(normalizedKind)) {
      return "Evaluation runs are exclusive in chat.";
    }
    return null;
  }

  function add(candidate: Candidate) {
    const item: ContextItem = {
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      subtitle: candidate.subtitle,
      body: candidate.body,
      meta: candidate.meta
    };
    run.addContext(item);
  }

  function remove(id: string) {
    run.removeContext(id);
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        run.setPickerOpen(open);
        if (!open) setQuery("");
      }}
      open={run.pickerOpen}
    >
      <DialogContent
        aria-describedby={undefined}
        className="!top-[12vh] !translate-y-0 flex max-h-[calc(100vh-16vh)] h-[min(70vh,calc(100vh-16vh))] w-[min(960px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-panel p-0 shadow-[var(--shadow-popover)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        hideClose
      >
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Icon name="search" className="text-muted-foreground" size={16} />
            <form className="flex-1" onSubmit={handleSubmit}>
              <Input
                ref={inputRef}
                className="h-7 w-full border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search roles, skills, library, workstreams…"
                value={query}
                variant="ghost"
              />
            </form>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {run.contextItems.length} attached
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border bg-panel-raised p-1.5">
              {SECTIONS.map((section) => {
                const icon = section.icon;
                const attachedCount = run.contextItems.filter((item) => item.kind === section.id).length;
                return (
                  <button
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                      active === section.id
                        ? "bg-selected text-foreground"
                        : "text-muted-foreground hover:bg-hover hover:text-foreground"
                    )}
                    key={section.id}
                    onClick={() => setActive(section.id)}
                    type="button"
                  >
                    {icon}
                    <span className="flex-1">{section.label}</span>
                    {attachedCount > 0 ? (
                      <span className="text-[10px] text-muted-foreground">{attachedCount} attached</span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border px-4 py-2">
                <div className="text-xs text-foreground">
                  {SECTIONS.find((entry) => entry.id === active)?.label}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {SECTIONS.find((entry) => entry.id === active)?.blurb}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {filtered.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-muted-foreground">
                    <Icon name="boxes" size={16} />
                    <div className="text-xs">No matches</div>
                    <div className="text-[11px]">
                      Add a {active} from the {SECTIONS.find((entry) => entry.id === active)?.label} page.
                    </div>
                  </div>
                ) : (
                  <ul className="grid gap-1">
                    {filtered.map((entry) => {
                      const selected = selectedIds.has(entry.id);
                      const reason = selected ? null : conflictReason(entry);
                      return (
                        <li key={entry.id}>
                          <button
                            className={cn(
                              "group flex w-full items-start gap-2.5 rounded-md border border-transparent px-2.5 py-1.5 text-left transition-colors",
                              selected ? "border-border bg-selected" : reason ? "cursor-not-allowed opacity-50" : "hover:bg-hover"
                            )}
                            disabled={Boolean(reason)}
                            onClick={() => (selected ? remove(entry.id) : add(entry))}
                            title={reason ?? entry.subtitle ?? entry.title}
                            type="button"
                          >
                            <span
                              className={cn(
                                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                                selected ? "border-foreground-strong bg-foreground-strong text-background" : "border-border"
                              )}
                            >
                              {selected ? <Icon name="check" size={12} /> : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <Icon name="file-text" className="text-muted-foreground" size={12} />
                                <span className="truncate text-[13px] text-foreground">{entry.title}</span>
                              </span>
                              {entry.subtitle ? (
                                <span className="line-clamp-1 text-[11px] text-muted-foreground">
                                  {entry.subtitle}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {entry.kind}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border bg-panel-raised px-4 py-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span>
                <kbd className="rounded border border-border bg-panel px-1 font-mono">↑↓</kbd> navigate
              </span>
              <span>
                <kbd className="rounded border border-border bg-panel px-1 font-mono">↵</kbd> select
              </span>
              <span>
                <kbd className="rounded border border-border bg-panel px-1 font-mono">esc</kbd> close
              </span>
            </div>
            <Button onClick={() => run.setPickerOpen(false)} size="sm" type="button" variant="primary">
              Done
            </Button>
          </div>
      </DialogContent>
    </Dialog>
  );
}
