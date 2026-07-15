"use client";

import { CONTEXT_ICON, Icon, CONTEXT_KIND_ICONS, ENTITY_ICONS, EVENT_ICONS } from "@spielos/design-system/components";
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
  Button,
  Notice,
  Pill,
  StatusIcon,
  cn,
} from "@spielos/design-system";
import { useRunContext, type ContextItem } from "../../lib/run-context";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import { capabilitiesForModel } from "@spielos/core";
import { reasoningLabel, type ReasoningEffort } from "../reasoning-effort-control";
import { ToolCallCard } from "./tool-call";
import {
  isFailureEvent,
  isStartEvent,
  isSuccessEvent,
  isWaitingEvent,
  orderRunEvents,
  runtimeEventIcon
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

function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString();
}

function CapacityMeter({ label, value, maximum, icon }: { label: string; value: number; maximum: number; icon: string }) {
  const ratio = maximum > 0 ? Math.min(1, value / maximum) : 0;
  const filled = Math.ceil(ratio * 12);
  const tone = ratio >= 0.9 ? "bg-destructive" : ratio >= 0.75 ? "bg-warning" : "bg-info";
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1.5 text-2xs">
        <Icon className="text-muted-foreground" name={icon} size={10} />
        <span className="font-medium text-foreground">{label}</span>
        <span className="ml-auto tabular-nums text-muted-foreground">{compactTokens(value)} / {compactTokens(maximum)}</span>
      </div>
      <div aria-label={`${label} ${Math.round(ratio * 100)} percent used`} className="grid grid-cols-12 gap-0.5">
        {Array.from({ length: 12 }, (_, index) => (
          <span className={cn("h-1 rounded-full", index < filled ? tone : "bg-input")} key={index} />
        ))}
      </div>
    </div>
  );
}

function RuntimeCapacity({ run }: { run: ReturnType<typeof useRunContext> }) {
  const store = useWorkspaceStore();
  const activeChat = store.chats.find((chat) => chat.id === store.activeChatId) ?? null;
  const configuredModelId = typeof activeChat?.metadata?.modelId === "string" ? activeChat.metadata.modelId : run.pendingModelId;
  const model = store.models.find((entry) => entry.id === configuredModelId && entry.enabled) ?? store.models.find((entry) => entry.enabled) ?? null;
  const capabilities = model ? capabilitiesForModel(model) : null;
  const effort = (typeof activeChat?.metadata?.reasoningEffort === "string" ? activeChat.metadata.reasoningEffort : run.pendingReasoningEffort) as ReasoningEffort;
  const budget = run.durableState?.budget;
  const usage = run.liveUsage;
  const contextMaximum = budget?.maxInputTokens ?? capabilities?.contextWindow ?? 0;
  const outputMaximum = budget?.maxOutputTokens ?? capabilities?.maxOutputTokens ?? 0;
  const outputValue = usage?.outputTokens ?? budget?.outputTokens ?? 0;
  const historicalCumulativeOutput = !budget?.maxOutputTokens && outputMaximum > 0 && outputValue > outputMaximum;
  const compaction = activeChat?.metadata?.compaction && typeof activeChat.metadata.compaction === "object"
    ? activeChat.metadata.compaction as Record<string, unknown>
    : null;
  const compactedMessages = typeof compaction?.compactedMessageCount === "number" ? compaction.compactedMessageCount : 0;

  return (
    <section className="grid gap-3 rounded-md bg-panel-raised p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-panel text-info">
          <Icon name={effort === "xhigh" || effort === "max" ? "zap" : "brain"} size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{model?.name ?? "No model configured"}</div>
          <div className="truncate text-3xs text-muted-foreground">{model ? `${model.provider} · ${model.model}` : "Add a model in Settings"}</div>
        </div>
        <Pill tone={effort === "xhigh" || effort === "max" ? "info" : "default"}>
          <Icon name={effort === "xhigh" || effort === "max" ? "zap" : "brain"} size={9} />
          {reasoningLabel(effort)}
        </Pill>
      </div>
      {capabilities ? (
        <>
          <CapacityMeter icon={CONTEXT_ICON} label="Context window" maximum={contextMaximum} value={usage?.inputTokens ?? budget?.inputTokens ?? 0} />
          {historicalCumulativeOutput ? (
            <div className="grid gap-1 rounded-md bg-panel px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-2xs">
                <Icon className="text-muted-foreground" name="arrow-up" size={10} />
                <span className="font-medium text-foreground">Generated output</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{compactTokens(outputValue)} total</span>
              </div>
              <div className="text-3xs text-muted-foreground">Historical cumulative run · {compactTokens(outputMaximum)} per-call cap</div>
            </div>
          ) : (
            <CapacityMeter icon="arrow-up" label="Output budget" maximum={outputMaximum} value={outputValue} />
          )}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-md bg-panel px-2 py-1.5">
              <div className="text-3xs text-muted-foreground">Tools</div>
              <div className="mt-0.5 text-xs font-medium tabular-nums text-foreground">{usage || budget ? `${usage?.toolCalls ?? budget?.toolCalls ?? 0} / ${budget?.maxToolCalls ?? "∞"}` : "Ready"}</div>
            </div>
            <div className="rounded-md bg-panel px-2 py-1.5">
              <div className="text-3xs text-muted-foreground">Compaction</div>
              <div className="mt-0.5 text-xs font-medium tabular-nums text-foreground">{compactedMessages > 0 ? `${compactedMessages} msgs` : `${Math.round(capabilities.compactionThreshold * 100)}%`}</div>
            </div>
            <div className="rounded-md bg-panel px-2 py-1.5">
              <div className="text-3xs text-muted-foreground">Counter</div>
              <div className="mt-0.5 truncate text-xs font-medium capitalize text-foreground">{capabilities.tokenCounter}</div>
            </div>
          </div>
        </>
      ) : null}
    </section>
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

  return (
    <div className="flex flex-col gap-3 p-3">
      <RuntimeCapacity run={run} />
      {run.durableState ? (
        <section className="rounded-md bg-panel p-2.5">
          <div className="mb-2 flex items-center gap-2">
            <Icon className="text-muted-foreground" name="task" size={12} />
            <span className="text-2xs font-medium text-foreground">Execution state</span>
            {run.durableState.verification ? (
              <Pill className="ml-auto capitalize" tone={run.durableState.verification.status === "passed" ? "success" : run.durableState.verification.status === "failed" ? "destructive" : "warning"}>
                {run.durableState.verification.status}
              </Pill>
            ) : null}
          </div>
          {run.durableState.goal?.objective ? <p className="text-xs leading-5 text-foreground">{run.durableState.goal.objective}</p> : null}
          {run.durableState.progress?.milestone ? <p className="mt-1 text-2xs text-muted-foreground">Current: {run.durableState.progress.milestone}</p> : null}
          {run.durableState.progress?.nextActions?.[0] ? <p className="mt-1 text-2xs text-muted-foreground">Next: {run.durableState.progress.nextActions[0]}</p> : null}
          {run.durableState.budget?.deadlineAt ? <div className="mt-2"><Pill tone="warning"><Icon name="clock" size={9} /> deadline {new Date(run.durableState.budget.deadlineAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Pill></div> : null}
          {run.activeActors.length > 0 ? (
            <div className="mt-2 border-t border-border pt-2">
              <div className="mb-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">Active agents</div>
              <div className="flex flex-wrap gap-1">
                {run.activeActors.map((actor) => <Pill key={actor.agentId} tone="info">{actor.roleName} · {actor.nodeTitle}</Pill>)}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
      {run.contextItems.length === 0 ? (
        <InspectorEmptyState
          description="Use the add button in the composer to attach roles, skills, files, evals, or workflows."
          icon={CONTEXT_ICON}
          title="No context attached"
        />
      ) : null}
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

        if (event.type === "tool_call_started" || event.type === "tool_call_result") {
          return (
            <div className="flex min-h-8 items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-hover" key={event.id}>
              <ToolCallCard active={active} event={event} />
              <span className="ml-auto font-mono text-3xs text-muted-foreground shrink-0 self-center">
                {new Date(event.createdAt).toLocaleTimeString([], { hour12: false })}
              </span>
            </div>
          );
        }

        const failed = isFailureEvent(event);
        const waiting = isWaitingEvent(event);
        const success = isSuccessEvent(event);
        const tone = failed ? "destructive" : waiting ? "warning" : success ? "success" : active ? "info" : "neutral";
        const icon = runtimeEventIcon(event, EVENT_ICONS[event.type as keyof typeof EVENT_ICONS]);
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
              {typeof event.payload?.parallelCount === "number" && event.payload.parallelCount > 1 ? (
                <div className="mt-1"><Pill tone="info">parallel agents ×{event.payload.parallelCount}</Pill></div>
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
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const totalEvents = run.events.length;
  const totalArtifacts = run.artifacts.length;
  const totalContext = run.contextItems.length;
  const statusTone = run.status === "completed" ? "success" : run.status === "failed" || run.status === "cancelled" ? "destructive" : run.status === "waiting_human" ? "warning" : run.status === "running" ? "info" : "default";

  async function control(action: "pause" | "resume" | "retry" | "cancel") {
    if (!run.activeRunId || controlBusy) return;
    setControlBusy(true);
    setControlError(null);
    try {
      if (action === "pause" || action === "cancel") {
        const response = await fetch(`/api/runs/${run.activeRunId}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: action === "pause" ? JSON.stringify({ reason: "Paused from the run inspector." }) : undefined });
        if (!response.ok) throw new Error(`${action === "pause" ? "Pause" : "Cancel"} failed (${response.status}).`);
        run.setRunStatus(action === "pause" ? "waiting_human" : "cancelled");
        return;
      }
      const response = await fetch(`/api/runs/${run.activeRunId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: action, answers: {} })
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `${action === "resume" ? "Resume" : "Retry"} failed (${response.status}).`);
      }
      run.setRunStatus("running");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          const item = JSON.parse(line.slice(6)) as { kind: string; event?: import("@spielos/core").RunEvent; artifact?: import("@spielos/core").Artifact; request?: import("@spielos/core").HumanInputRequest; state?: import("../../lib/run-context").DurableRunState; text?: string; status?: string; message?: string };
          if (item.kind === "event" && item.event) run.appendEvent(item.event);
          if (item.kind === "artifact" && item.artifact) run.appendArtifact(item.artifact);
          if (item.kind === "human_input" && item.request) run.setHumanInputRequest(item.request);
          if (item.kind === "text" && item.text) run.appendContinuationText(item.text);
          if (item.kind === "status" && item.message) run.setActivity(item.message);
          if (item.kind === "run_state" && item.state) run.setDurableState(item.state);
          if (item.kind === "done" && item.status && ["running", "waiting_human", "completed", "failed", "cancelled"].includes(item.status)) run.setRunStatus(item.status as import("@spielos/core").RunStatus);
        }
      }
    } catch (cause) {
      setControlError(cause instanceof Error ? cause.message : "Run control failed.");
    } finally {
      setControlBusy(false);
    }
  }

  return (
    <Inspector>
      <InspectorHeader actions={run.status !== "idle" ? <Pill tone={statusTone}>{run.status === "waiting_human" ? "waiting" : run.status}</Pill> : null} icon={ENTITY_ICONS.run} title="Run inspector" />

      <InspectorTabs
        onChange={(value) => setSection(value as Section)}
        tabs={[
          { id: "context", label: `Context ${totalContext}`, icon: CONTEXT_ICON },
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
        {controlError ? <Notice className="mb-2" tone="destructive">{controlError}</Notice> : null}
        <div className="flex items-center gap-1.5">
          <span className="mr-auto">{totalContext} attached · {totalEvents} events · {totalArtifacts} artifacts</span>
          {run.status === "running" ? <Button disabled={controlBusy} onClick={() => void control("pause")} size="sm" variant="outline">Pause</Button> : null}
          {run.status === "running" ? <Button disabled={controlBusy} onClick={() => void control("cancel")} size="sm" variant="ghost">Cancel</Button> : null}
          {run.status === "waiting_human" && !run.humanInputRequest ? <Button loading={controlBusy} onClick={() => void control("resume")} size="sm">Resume</Button> : null}
          {(run.status === "failed" || run.status === "cancelled") && run.runType !== "chat" ? <Button loading={controlBusy} onClick={() => void control("retry")} size="sm">Retry</Button> : null}
        </div>
      </InspectorFooter>
    </Inspector>
  );
}
