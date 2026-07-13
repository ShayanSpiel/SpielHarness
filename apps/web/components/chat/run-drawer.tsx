"use client";

import { Icon, CONTEXT_KIND_ICONS, ENTITY_ICONS, EVENT_ICONS } from "@spielos/design-system/components";
import {
  type ReactNode,
  useMemo,
  useState
} from "react";
import {
  Inspector,
  InspectorBody,
  InspectorEmptyState,
  InspectorFooter,
  InspectorHeader,
  InspectorTabs,
  Pill,
  StatusIcon,
  cn,
} from "@spielos/design-system";
import { useRunContext, type ContextItem } from "../../lib/run-context";
import {
  isFailureEvent,
  isStartEvent,
  isSuccessEvent,
  isWaitingEvent,
  orderRunEvents
} from "../../lib/run-events";

type Section = "context" | "events" | "output";

const CONTEXT_ICONS: Record<string, ReactNode> = {
  role: <Icon name={CONTEXT_KIND_ICONS.role} size={12} />,
  skill: <Icon name={CONTEXT_KIND_ICONS.skill} size={12} />,
  library: <Icon name={CONTEXT_KIND_ICONS.library} size={12} />,
  workstream: <Icon name={CONTEXT_KIND_ICONS.workstream} size={12} />,
  strategy: <Icon name={CONTEXT_KIND_ICONS.strategy} size={12} />,
  knowledge: <Icon name={CONTEXT_KIND_ICONS.knowledge} size={12} />,
  prompt: <Icon name={CONTEXT_KIND_ICONS.prompt} size={12} />,
  eval: <Icon name={CONTEXT_KIND_ICONS.eval} size={12} />
};

function ContextRow({ item }: { item: ContextItem }) {
  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors duration-[var(--duration)] hover:bg-hover">
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
        {CONTEXT_ICONS[item.kind] ?? <Icon name="file-text" size={12} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-foreground">{item.title}</span>
        </div>
        {item.subtitle ? (
          <div className="line-clamp-1 text-2xs text-muted-foreground">{item.subtitle}</div>
        ) : null}
      </div>
      <Pill className="h-4 text-3xs capitalize">{item.kind}</Pill>
    </div>
  );
}

function ContextSection({ run }: { run: ReturnType<typeof useRunContext> }) {
  const grouped = useMemo(() => {
    const map = new Map<string, ContextItem[]>();
    for (const item of run.contextItems) {
      const list = map.get(item.kind) ?? [];
      list.push(item);
      map.set(item.kind, list);
    }
    return Array.from(map.entries());
  }, [run.contextItems]);

  if (run.contextItems.length === 0) {
    return (
      <InspectorEmptyState
        description="Use the add button in the composer to attach roles, skills, files, evals, or workflows."
        icon={ENTITY_ICONS.skill}
        title="No context attached"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {grouped.map(([kind, items]) => (
        <div className="flex flex-col gap-1.5" key={kind}>
          <div className="flex items-center gap-1.5 text-3xs uppercase tracking-wider text-muted-foreground">
            {CONTEXT_ICONS[kind]}
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

function EventsSection({ run }: { run: ReturnType<typeof useRunContext> }) {
  if (run.events.length === 0) {
    return (
      <InspectorEmptyState
        description={run.running ? "Waiting for the runtime to emit its first native event." : "Native runtime events appear here during a run."}
        icon="activity"
        title={run.running ? "Waiting for events" : "No events yet"}
      />
    );
  }

  const orderedEvents = orderRunEvents(run.events);
  const latestEvent = orderedEvents.at(-1);
  const activeEventId = run.running && latestEvent && isStartEvent(latestEvent) ? latestEvent.id : null;

  return (
    <div className="flex flex-col gap-0.5 p-2">
      {orderedEvents.map((event) => {
        const active = event.id === activeEventId;
        const failed = isFailureEvent(event);
        const waiting = isWaitingEvent(event);
        const success = isSuccessEvent(event);
        const tone = failed ? "destructive" : waiting ? "warning" : success ? "success" : active ? "info" : "neutral";
        const icon = EVENT_ICONS[event.type as keyof typeof EVENT_ICONS] ?? "circle-dot";
        return (
          <div
            className="flex min-h-8 items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-hover"
            key={event.id}
          >
            <StatusIcon busy={active} className="mt-0.5 h-4 w-4" icon={icon} tone={tone} size={10} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-2xs text-foreground">
                <span className={cn("min-w-0 flex-1 leading-4", failed && "text-destructive", waiting && "text-warning")}>{event.message}</span>
                <span className="ml-auto font-mono text-3xs text-muted-foreground shrink-0">
                  {new Date(event.createdAt).toLocaleTimeString([], { hour12: false })}
                </span>
              </div>
              {event.nodeTitle || event.skillName ? (
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-3xs text-muted-foreground">
                  {event.nodeTitle ? <span className="truncate">{event.nodeTitle}</span> : null}
                  {event.nodeTitle && event.skillName ? <span>·</span> : null}
                  {event.skillName ? <span className="truncate">{event.skillName}</span> : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OutputSection({ run }: { run: ReturnType<typeof useRunContext> }) {
  if (run.artifacts.length === 0) {
    return (
      <InspectorEmptyState
        description="Files and structured artifacts appear here when the runtime emits them."
        icon="layers"
        title="No outputs yet"
      />
    );
  }
  return (
    <div className="flex flex-col gap-2 p-3">
      {run.artifacts.map((artifact) => (
        <article className="overflow-hidden rounded-md border border-border bg-panel" key={artifact.id}>
          <header className="flex items-center gap-2 border-b border-border bg-panel-raised px-2.5 py-1.5">
            <Icon name="file-text" className="text-muted-foreground" size={12} />
            <span className="truncate text-xs font-medium text-foreground">{artifact.title}</span>
            <Pill className="ml-auto text-3xs uppercase tracking-wider">{artifact.type}</Pill>
          </header>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-2.5 text-2xs leading-relaxed text-foreground/90">
            {artifact.body}
          </pre>
        </article>
      ))}
    </div>
  );
}

export function RunDrawer() {
  const run = useRunContext();
  const [section, setSection] = useState<Section>("context");
  const totalEvents = run.events.length;
  const totalArtifacts = run.artifacts.length;
  const totalContext = run.contextItems.length;

  return (
    <Inspector>
      <InspectorHeader icon={ENTITY_ICONS.run} title="Run inspector" />

      <InspectorTabs
        onChange={(value) => setSection(value as Section)}
        tabs={[
          { id: "context", label: `Context ${totalContext}`, icon: "reading-glass" },
          { id: "events", label: `Events ${totalEvents}`, icon: "activity" },
          { id: "output", label: `Outputs ${totalArtifacts}`, icon: "layers" }
        ]}
        value={section}
      />

      <InspectorBody>
        {section === "context" ? <ContextSection run={run} /> : null}
        {section === "events" ? <EventsSection run={run} /> : null}
        {section === "output" ? <OutputSection run={run} /> : null}
      </InspectorBody>

      <InspectorFooter>
        <div className="flex items-center justify-between">
          <span>{totalContext} attached · {totalEvents} events · {totalArtifacts} artifacts</span>
        </div>
      </InspectorFooter>
    </Inspector>
  );
}
