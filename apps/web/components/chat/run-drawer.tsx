"use client";

import { Icon } from "../icons";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { cn } from "@spielos/design-system";
import { useRunContext, type ContextItem, type ContextItemKind } from "../../lib/run-context";
import { useWorkspaceStore } from "../../lib/use-workspace-store";

type Section = "context" | "events" | "output";

const ICONS: Record<ContextItemKind, ReactNode> = {
  role: <Icon name="users" size={12} />,
  tool: <Icon name="sparkles" size={12} />,
  library: <Icon name="archive" size={12} />,
  workstream: <Icon name="folder-kanban" size={12} />,
  strategy: <Icon name="file-text" size={12} />,
  knowledge: <Icon name="brain" size={12} />,
  eval: <Icon name="bar-chart" size={12} />
};

function eventTone(type: string): "default" | "active" | "success" | "destructive" {
  if (type === "run_completed") return "success";
  if (type === "run_failed" || type === "run_cancelled") return "destructive";
  if (type === "node_started" || type === "node_status" || type === "human_input_requested") return "active";
  return "default";
}

function eventIcon(type: string): ReactNode {
  if (type === "run_completed") return <Icon name="check" size={10} />;
  if (type === "run_failed" || type === "run_cancelled") return <Icon name="x" size={10} />;
  if (type === "node_started" || type === "node_status" || type === "skill_started") return <Icon name="circle-dot" size={10} />;
  if (type === "node_completed" || type === "skill_completed") return <Icon name="check" size={10} />;
  if (type === "artifact_created") return <Icon name="file-text" size={10} />;
  if (type === "eval_score_updated") return <Icon name="bar-chart" size={10} />;
  if (type === "human_input_requested") return <Icon name="user" size={10} />;
  if (type === "human_input_received") return <Icon name="check-circle" size={10} />;
  return <span className="block h-1.5 w-1.5 rounded-full bg-current" />;
}

function isOpaqueId(value?: string | null) {
  return Boolean(value && (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) || /^(node|evt|run|skill|role|art)_/.test(value)));
}

function readableNode(event: { node?: string | null; payload?: Record<string, unknown> }) {
  const fromPayload = event.payload?.nodeTitle;
  if (typeof fromPayload === "string") return fromPayload;
  return isOpaqueId(event.node) ? undefined : event.node ?? undefined;
}

function readableSkill(event: { skill?: string | null; payload?: Record<string, unknown> }) {
  const fromPayload = event.payload?.skillName;
  if (typeof fromPayload === "string") return fromPayload;
  return isOpaqueId(event.skill) ? undefined : event.skill ?? undefined;
}

function eventLabel(event: { type: string; node?: string | null; skill?: string | null; payload?: Record<string, unknown> }) {
  const node = readableNode(event);
  const skill = readableSkill(event);
  if (event.type === "node_started") return `Step started${node ? `: ${node}` : ""}`;
  if (event.type === "node_completed") return `Step completed${node ? `: ${node}` : ""}`;
  if (event.type === "skill_started") return `Skill started${skill ? `: ${skill}` : ""}`;
  if (event.type === "skill_completed") return `Skill completed${skill ? `: ${skill}` : ""}`;
  if (event.type === "eval_score_updated") {
    const score = event.payload?.score;
    const threshold = event.payload?.threshold;
    const attempt = event.payload?.attempt ?? 1;
    const passed = event.payload?.passed === true;
    return `Eval try ${attempt}: ${passed ? "Passed" : "Failed"}${typeof score === "number" ? ` (${score}/${threshold ?? 100})` : ""}`;
  }
  if (event.type === "human_input_requested") return "Question asked";
  if (event.type === "human_input_received") return "Answer received";
  if (event.type === "run_completed") return "Run completed";
  if (event.type === "run_failed") return "Run failed";
  return event.type.replace(/_/g, " ").replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

function eventDetail(event: { message: string; payload?: Record<string, unknown> }) {
  if (event.payload?.score && event.payload?.threshold) {
    return `${event.message} Threshold: ${event.payload.threshold}.`;
  }
  return event.message;
}

function SectionHeader({
  label,
  icon,
  count,
  active,
  onClick
}: {
  id: Section;
  label: string;
  icon: ReactNode;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
        active ? "bg-selected text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-sm border border-border">
        {icon}
      </span>
      <span className="flex-1 font-medium">{label}</span>
      {typeof count === "number" ? (
        <span className="rounded-full bg-panel-raised px-1.5 py-0 text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
      <Icon name="chevron-right"
        className={cn(
          "transition-transform",
          active && "rotate-90"
        )}
        size={12}
      />
    </button>
  );
}

function ContextRow({ item }: { item: ContextItem }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-panel-raised px-2.5 py-1.5">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-border bg-panel text-muted-foreground">
        {ICONS[item.kind] ?? <Icon name="file-text" size={12} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-foreground">{item.title}</span>
        </div>
        {item.subtitle ? (
          <div className="line-clamp-1 text-[11px] text-muted-foreground">{item.subtitle}</div>
        ) : null}
      </div>
      <span className="rounded-full bg-panel px-1.5 py-0 text-[10px] uppercase tracking-wider text-muted-foreground">
        {item.kind}
      </span>
    </div>
  );
}

function ContextSection() {
  const run = useRunContext();
  const grouped = useMemo(() => {
    const map = new Map<ContextItemKind, ContextItem[]>();
    for (const item of run.contextItems) {
      const list = map.get(item.kind) ?? [];
      list.push(item);
      map.set(item.kind, list);
    }
    return Array.from(map.entries());
  }, [run.contextItems]);

  if (run.contextItems.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center text-[11px] text-muted-foreground">
        <Icon name="sparkles" size={14} />
        <div>No context attached yet.</div>
        <div>Click the + in the composer to add roles, skills, library, or workstreams.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {grouped.map(([kind, items]) => (
        <div className="flex flex-col gap-1.5" key={kind}>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {ICONS[kind]}
            <span>{kind}</span>
            <span className="ml-auto tabular-nums">{items.length}</span>
          </div>
          <div className="flex flex-col gap-1">
            {items.map((item) => (
              <ContextRow item={item} key={item.id} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EventsSection() {
  const run = useRunContext();
  if (run.events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center text-[11px] text-muted-foreground">
        <Icon name="activity" size={14} />
        {run.running ? (
          <div>Waiting for events…</div>
        ) : (
          <div>Events will stream here when a run starts.</div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-2">
      {run.events.map((event) => {
        const tone = eventTone(event.type);
        return (
          <div
            className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover transition-colors"
            key={event.id}
          >
            <span
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border bg-panel",
                tone === "success" && "border-foreground-strong text-foreground-strong",
                tone === "destructive" && "border-foreground-strong text-foreground-strong",
                tone === "active" && "border-foreground-strong text-foreground-strong",
                tone === "default" && "border-border text-muted-foreground"
              )}
            >
              {eventIcon(event.type)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] text-foreground">
                <span className="font-medium">{eventLabel(event)}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground shrink-0">
                  {new Date(event.receivedAt).toLocaleTimeString([], { hour12: false })}
                </span>
              </div>
              {event.message ? (
                <div className="line-clamp-3 text-[11px] text-muted-foreground mt-0.5">{eventDetail(event)}</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OutputSection() {
  const run = useRunContext();
  if (run.artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center text-[11px] text-muted-foreground">
        <Icon name="layers" size={14} />
        {run.running ? (
          <div>Waiting for output…</div>
        ) : (
          <div>Artifacts produced by the run appear here.</div>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-3">
      {run.artifacts.map((artifact) => (
        <article className="overflow-hidden rounded-md border border-border bg-panel" key={artifact.id}>
          <header className="flex items-center gap-2 border-b border-border bg-panel-raised px-2.5 py-1.5">
            <Icon name="file-text" className="text-muted-foreground" size={12} />
            <span className="truncate text-xs font-medium text-foreground">{artifact.title}</span>
            <span className="ml-auto rounded-full bg-panel px-1.5 py-0 text-[10px] uppercase tracking-wider text-muted-foreground">
               {artifact.type}
             </span>
          </header>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-2.5 text-[11px] leading-relaxed text-foreground/90">
            {artifact.body}
          </pre>
        </article>
      ))}
    </div>
  );
}

export function RunDrawer() {
  const run = useRunContext();
  const store = useWorkspaceStore();
  const [section, setSection] = useState<Section>("context");
  const wasRunning = useRef(false);
  const openedInspector = useRef(false);

  const setInspectorOpen = store.setInspectorOpen;

  useEffect(() => {
    if (run.running && run.contextItems.length > 0 && !openedInspector.current) {
      wasRunning.current = true;
      openedInspector.current = true;
      setInspectorOpen(true);
    } else if (wasRunning.current && !run.running) {
      wasRunning.current = false;
      openedInspector.current = false;
    }
  }, [run.running, run.contextItems.length, setInspectorOpen]);

  const totalEvents = run.events.length;
  const totalArtifacts = run.artifacts.length;
  const totalContext = run.contextItems.length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel-raised px-3">
        <Icon name="play" size={14} className="text-muted-foreground" />
        <div className="flex flex-col leading-tight min-w-0 flex-1">
          <span className="text-xs font-medium text-foreground">Run inspector</span>
          <span className="text-[10px] text-muted-foreground truncate">
            {run.running ? (run.activity ?? "Streaming...") : run.runTitle}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {run.running ? (
            <span className="flex items-center gap-1 rounded-full bg-panel px-1.5 py-0.5 text-xs text-foreground">
              <Icon name="loader" className="animate-spin" size={10} /> live
            </span>
          ) : totalEvents > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-panel px-1.5 py-0.5 text-xs text-foreground">
              <Icon name="check" size={10} /> idle
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex shrink-0 flex-col gap-0.5 border-b border-border p-1.5">
        <SectionHeader
          active={section === "context"}
          count={totalContext}
          icon={<Icon name="sparkles" size={12} />}
          id="context"
          label="Context"
          onClick={() => setSection("context")}
        />
        <SectionHeader
          active={section === "events"}
          count={totalEvents}
          icon={<Icon name="activity" size={12} />}
          id="events"
          label="Events"
          onClick={() => setSection("events")}
        />
        <SectionHeader
          active={section === "output"}
          count={totalArtifacts}
          icon={<Icon name="layers" size={12} />}
          id="output"
          label="Output"
          onClick={() => setSection("output")}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === "context" ? <ContextSection /> : null}
        {section === "events" ? <EventsSection /> : null}
        {section === "output" ? <OutputSection /> : null}
      </div>

      <footer className="shrink-0 border-t border-border bg-panel-raised px-3 py-1.5 text-[10px] text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>{totalContext} attached · {totalEvents} events · {totalArtifacts} artifacts</span>
        </div>
        {store.activeChatId ? null : (
          <div className="mt-1 flex items-center gap-1.5">
            <Icon name="play" size={10} />
            <span>Send a message to start a run.</span>
          </div>
        )}
      </footer>
    </div>
  );
}
