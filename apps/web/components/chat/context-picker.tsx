"use client";

import { Icon, CONTEXT_KIND_ICONS, ENTITY_ICONS } from "@spielos/design-system/components";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { ActionRow, Button, Dialog, DialogContent, EmptyState, Input, Pill, cn } from "@spielos/design-system";
import { useRunContext, type ContextItem } from "../../lib/run-context";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import { type ExecutionMode } from "@spielos/core";

type Section = {
  id: string;
  label: string;
  icon: ReactNode;
  blurb: string;
  kinds: string[];
};

const SECTIONS: Section[] = [
  { id: "role", label: "Roles", icon: <Icon name={ENTITY_ICONS.role} size={14} />, blurb: "Agents that will collaborate", kinds: ["role"] },
  { id: "skill", label: "Skills", icon: <Icon name={ENTITY_ICONS.skill} size={14} />, blurb: "Callable capabilities the team can use", kinds: ["skill"] },
  { id: "workflow", label: "Workflows", icon: <Icon name={ENTITY_ICONS.workflow} size={14} />, blurb: "Multi-step graphs", kinds: ["workflow"] },
  { id: "eval", label: "Evals", icon: <Icon name={ENTITY_ICONS.eval} size={14} />, blurb: "Rubrics for scoring content, prompts, and workflows", kinds: ["eval"] },
  { id: "strategy", label: "Strategy", icon: <Icon name={ENTITY_ICONS.strategy} size={14} />, blurb: "Strategy documents and reusable prompts", kinds: ["strategy", "prompt"] },
  { id: "files", label: "Files", icon: <Icon name={ENTITY_ICONS.knowledge} size={14} />, blurb: "Local library content and saved outputs", kinds: ["knowledge", "library"] }
];

type Candidate = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
};

export function ContextPicker() {
  const run = useRunContext();
  const store = useWorkspaceStore();
  const [active, setActive] = useState<string>("role");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const activeChat = store.chats.find((chat) => chat.id === store.activeChatId) ?? null;
  const executionMode: ExecutionMode = typeof activeChat?.metadata?.executionMode === "string"
    ? activeChat.metadata.executionMode as ExecutionMode
    : run.pendingExecutionMode as ExecutionMode;

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
        return store.roles
          .filter((r) => r.status === "active")
          .map((r) => ({ id: r.id, kind: "role", title: r.name, subtitle: r.description?.slice(0, 80) }));
      case "skill":
        return store.skills
          .filter((s) => s.status === "active")
          .map((s) => ({ id: s.id, kind: "skill", title: s.name, subtitle: `${s.slug} · ${s.sideEffect}` }));
      case "eval":
        return store.evalFiles
          .filter((e) => e.status === "active")
          .map((e) => ({ id: e.id, kind: "eval", title: e.name, subtitle: `${e.rules.length} rules · threshold ${e.overallThreshold}` }));
      case "workflow":
        return store.workflows
          .filter((w) => w.status === "active")
          .map((w) => ({ id: w.id, kind: "workflow", title: w.name, subtitle: `${w.nodes.length} steps · ${w.edges.length} edges` }));
      case "strategy":
        return store.items
          .filter((item) => ["strategy", "prompt"].includes(item.kind) && item.status !== "archived")
          .map((item) => ({ id: item.id, kind: item.kind, title: item.title, subtitle: item.folder ?? "Strategy" }));
      case "files":
        return store.items
          .filter((item) => ["knowledge", "library"].includes(item.kind) && item.status !== "archived")
          .map((item) => ({ id: item.id, kind: item.kind, title: item.title, subtitle: item.folder ?? "Library" }));
      default:
        return [];
    }
  }, [active, store.items, store.roles, store.skills, store.workflows, store.evalFiles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (entry) =>
        entry.title.toLowerCase().includes(q) ||
        (entry.subtitle?.toLowerCase().includes(q) ?? false)
    );
  }, [candidates, query]);

  const selectedIds = new Set(run.contextItems.map((entry) => entry.id));

  function conflictReason(candidate: Candidate) {
    if (executionMode === "director") return null;
    const executable = run.contextItems.map((item) => item.kind);
    const hasWorkflow = executable.includes("workflow");
    const hasRole = executable.includes("role");
    const hasSkill = executable.includes("skill");
    const hasEval = executable.includes("eval");

    if (candidate.kind === "workflow" && (hasWorkflow || hasRole || hasSkill || hasEval)) {
      return "Workflows run by themselves. Remove other executable targets first.";
    }
    if (hasWorkflow && ["role", "skill", "eval"].includes(candidate.kind)) {
      return "A workflow already controls its roles and skills.";
    }
    if (candidate.kind === "role" && hasRole) return "Only one role can be selected.";
    if (candidate.kind === "skill" && hasSkill) return "Only one direct skill can be selected.";
    if (candidate.kind === "eval" && (hasEval || hasRole || hasSkill || hasWorkflow)) {
      return "Run an evaluation separately or as a workflow gate.";
    }
    if (hasEval && ["role", "skill", "workflow"].includes(candidate.kind)) {
      return "Evaluation runs are exclusive in chat.";
    }
    return null;
  }

  function getReason(id: string) {
    const c = candidates.find((entry) => entry.id === id);
    if (!c) return null;
    return conflictReason(c);
  }

  function toggle(candidate: Candidate) {
    if (selectedIds.has(candidate.id)) {
      run.removeContext(candidate.id);
    } else {
      const reason = getReason(candidate.id);
      if (reason) return;
      const item: ContextItem = {
        id: candidate.id,
        kind: candidate.kind,
        title: candidate.title,
        subtitle: candidate.subtitle
      };
      run.addContext(item);
    }
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
        hideClose
        layout="context"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Icon name="search" className="text-muted-foreground" size={16} />
          <form className="flex-1" onSubmit={handleSubmit}>
            <Input
              ref={inputRef}
              className="h-7 w-full border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search roles, skills, workflows, strategy, and files..."
              value={query}
              variant="ghost"
            />
          </form>
          <div className="text-3xs uppercase tracking-wider text-muted-foreground">
            {run.contextItems.length} attached
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border bg-panel-raised p-1.5">
            {SECTIONS.map((section) => {
              const attachedCount = run.contextItems.filter((item) => section.kinds.includes(item.kind)).length;
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
                  {section.icon}
                  <span className="flex-1">{section.label}</span>
                  {attachedCount > 0 ? (
                    <span className="text-3xs text-muted-foreground">{attachedCount} attached</span>
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
              <div className="text-2xs text-muted-foreground">
                {SECTIONS.find((entry) => entry.id === active)?.blurb}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <EmptyState
                  description={`Add an item from the ${SECTIONS.find((entry) => entry.id === active)?.label} page.`}
                  icon={<Icon name="boxes" size={16} />}
                  title="No matches"
                />
              ) : (
                <ul className="grid gap-1">
                  {filtered.map((entry) => {
                    const selected = selectedIds.has(entry.id);
                    const reason = selected ? null : getReason(entry.id);
                    return (
                      <li key={entry.id}>
                        <ActionRow
                          active={selected}
                          description={entry.subtitle}
                          disabled={Boolean(reason)}
                          leading={<Icon name={CONTEXT_KIND_ICONS[entry.kind] ?? "file-text"} className="text-muted-foreground" size={12} />}
                          onClick={() => toggle(entry)}
                          title={entry.title}
                          trailing={<Pill tone={selected ? "primary" : "default"}>{selected ? "Attached" : "Add"}</Pill>}
                          aria-label={reason ? `${entry.title}: ${reason}` : entry.title}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border bg-panel-raised px-4 py-2 text-2xs text-muted-foreground">
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
