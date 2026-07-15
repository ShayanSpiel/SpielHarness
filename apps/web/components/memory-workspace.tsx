"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MemoryKind, MemoryRecord, MemoryScope } from "@spielos/core";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  ListItem,
  NativeSelect,
  Notice,
  Pill,
  ResizableSidebar,
  Textarea,
  ToggleRow,
  toast
} from "@spielos/design-system";

type WorkspaceConfigFile = {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

type MemoryData = { memories: MemoryRecord[]; workspaceFiles: WorkspaceConfigFile[] };
type Selected = { type: "config"; id: string } | { type: "memory"; id: string } | { type: "new" };

const EMPTY_MEMORY = {
  title: "",
  body: "",
  kind: "semantic" as MemoryKind,
  scope: "workspace" as MemoryScope,
  scopeId: "",
  reason: "Explicitly added by a workspace member.",
  confidence: 1,
  approved: false,
  pinned: false,
  supersedesId: ""
};

export function MemoryWorkspace() {
  const [data, setData] = useState<MemoryData>({ memories: [], workspaceFiles: [] });
  const [selected, setSelected] = useState<Selected | null>(null);
  const [memoryDraft, setMemoryDraft] = useState(EMPTY_MEMORY);
  const [configDraft, setConfigDraft] = useState<WorkspaceConfigFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("current");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/memory", { cache: "no-store" });
      if (!response.ok) throw new Error("Memory state could not be loaded.");
      const next = await response.json() as MemoryData;
      setData(next);
      setSelected((current) => current ?? (next.workspaceFiles[0]
        ? { type: "config", id: next.workspaceFiles[0].id }
        : next.memories[0] ? { type: "memory", id: next.memories[0].id } : null));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Memory state could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeMemory = useMemo(
    () => selected?.type === "memory" ? data.memories.find((memory) => memory.id === selected.id) ?? null : null,
    [data.memories, selected]
  );
  const visibleMemories = useMemo(() => data.memories.filter((memory) => {
    if (memory.status === "forgotten") return false;
    if (statusFilter === "approved" && memory.status !== "approved") return false;
    if (statusFilter === "proposed" && memory.status !== "proposed") return false;
    if (statusFilter === "current" && memory.status === "superseded") return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${memory.title} ${memory.body} ${memory.scope} ${memory.kind}`.toLowerCase().includes(needle);
  }), [data.memories, query, statusFilter]);
  const stats = useMemo(() => ({
    approved: data.memories.filter((memory) => memory.status === "approved").length,
    proposed: data.memories.filter((memory) => memory.status === "proposed").length,
    pinned: data.memories.filter((memory) => memory.pinned && memory.status === "approved").length,
    conflicts: data.memories.filter((memory) => memory.conflictIds.length > 0 && memory.status === "proposed").length
  }), [data.memories]);

  useEffect(() => {
    if (selected?.type === "config") {
      setConfigDraft(data.workspaceFiles.find((file) => file.id === selected.id) ?? null);
      return;
    }
    if (activeMemory) {
      setMemoryDraft({
        title: activeMemory.title,
        body: activeMemory.body,
        kind: activeMemory.kind,
        scope: activeMemory.scope,
        scopeId: activeMemory.scopeId ?? "",
        reason: activeMemory.provenance.reason,
        confidence: activeMemory.confidence,
        approved: activeMemory.status === "approved",
        pinned: activeMemory.pinned,
        supersedesId: activeMemory.supersedesId ?? ""
      });
    } else if (selected?.type === "new") {
      setMemoryDraft(EMPTY_MEMORY);
    }
  }, [activeMemory, data.workspaceFiles, selected]);

  async function saveConfig() {
    if (!configDraft) return;
    setSaving(true);
    try {
      const response = await fetch("/api/harness/files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: configDraft.id, title: configDraft.title, body: configDraft.body, metadata: configDraft.metadata })
      });
      if (!response.ok) throw new Error("Workspace definition could not be saved.");
      await load();
      toast.success("Workspace definition saved");
    } catch (cause) {
      toast.error("Workspace definition could not be saved", { description: cause instanceof Error ? cause.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function saveMemory() {
    setSaving(true);
    try {
      const isNew = selected?.type === "new";
      const response = await fetch("/api/memory", {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isNew ? {} : { id: activeMemory?.id }),
          title: memoryDraft.title,
          body: memoryDraft.body,
          kind: memoryDraft.kind,
          scope: memoryDraft.scope,
          scopeId: memoryDraft.scopeId || null,
          reason: memoryDraft.reason,
          provenance: activeMemory ? { ...activeMemory.provenance, reason: memoryDraft.reason } : undefined,
          confidence: memoryDraft.confidence,
          approved: memoryDraft.approved,
          approve: !isNew && memoryDraft.approved && activeMemory?.status !== "approved",
          pinned: memoryDraft.pinned,
          supersedesId: memoryDraft.supersedesId || null,
          sourceType: "user"
        })
      });
      const result = await response.json() as { memory?: MemoryRecord; error?: string };
      if (!response.ok || !result.memory) throw new Error(result.error ?? "Memory could not be saved.");
      await load();
      setSelected({ type: "memory", id: result.memory.id });
      toast.success(isNew ? "Memory created" : "Memory saved");
    } catch (cause) {
      toast.error("Memory could not be saved", { description: cause instanceof Error ? cause.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function forget(mode: "forget" | "remove") {
    if (!activeMemory) return;
    const response = await fetch(`/api/memory?id=${encodeURIComponent(activeMemory.id)}&mode=${mode}`, { method: "DELETE" });
    if (!response.ok) return toast.error(mode === "remove" ? "Memory could not be removed" : "Memory could not be forgotten");
    setRemoveOpen(false);
    setSelected(null);
    await load();
    toast.success(mode === "remove" ? "Memory removed" : "Memory forgotten");
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <ResizableSidebar sidebarId="strategy-memory" title="Memory">
        <div className="flex h-10 items-center border-b border-border px-3">
          <span className="text-xs font-semibold text-foreground">Memory state</span>
          <Button className="ml-auto" icon="plus" onClick={() => setSelected({ type: "new" })} size="sm" variant="ghost">New</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="grid gap-1.5 px-1 pb-2">
            <Input aria-label="Search memory" onChange={(event) => setQuery(event.target.value)} placeholder="Search memory…" value={query} />
            <NativeSelect ariaLabel="Memory status filter" onChange={setStatusFilter} options={[{ label: "Current memory", value: "current" }, { label: "Approved", value: "approved" }, { label: "Needs review", value: "proposed" }, { label: "All history", value: "all" }]} value={statusFilter} />
          </div>
          <div className="px-2 pb-1 pt-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">Workspace definition</div>
          {data.workspaceFiles.map((file) => (
            <ListItem active={selected?.type === "config" && selected.id === file.id} key={file.id} onClick={() => setSelected({ type: "config", id: file.id })} subtitle="Explicit configuration · highest authority" title={file.title} />
          ))}
          <div className="mt-3 px-2 pb-1 pt-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">Learned memory</div>
          {visibleMemories.map((memory) => (
            <ListItem
              active={selected?.type === "memory" && selected.id === memory.id}
              key={memory.id}
              metadata={<Pill tone={memory.status === "approved" ? "success" : memory.status === "superseded" ? "warning" : "default"}>{memory.status}</Pill>}
              onClick={() => setSelected({ type: "memory", id: memory.id })}
              subtitle={`${memory.kind} · ${memory.scope}${memory.pinned ? " · pinned" : ""}`}
              title={memory.title}
            />
          ))}
          {!loading && data.memories.length > 0 && visibleMemories.length === 0 ? (
            <div className="mx-2 mt-2 rounded-md border border-dashed border-border px-3 py-4 text-center">
              <p className="text-xs font-medium text-foreground">No matching memory</p>
              <p className="mt-1 text-3xs leading-4 text-muted-foreground">Clear the search or change the review filter.</p>
              <Button className="mt-2" onClick={() => { setQuery(""); setStatusFilter("current"); }} size="sm" variant="ghost">Clear filters</Button>
            </div>
          ) : null}
        </div>
      </ResizableSidebar>

      <section className="min-w-0 flex-1 overflow-y-auto bg-background">
        <div className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4">
          {[
            ["Approved", stats.approved, "Eligible for retrieval"],
            ["Needs review", stats.proposed, "Excluded until approved"],
            ["Pinned", stats.pinned, "Prioritized at retrieval"],
            ["Conflicts", stats.conflicts, "Requires supersession"]
          ].map(([label, value, description]) => (
            <div className="bg-panel px-4 py-3" key={String(label)}>
              <div className="text-lg font-semibold tabular-nums text-foreground">{value}</div>
              <div className="text-2xs font-medium text-foreground">{label}</div>
              <div className="mt-0.5 text-3xs text-muted-foreground">{description}</div>
            </div>
          ))}
        </div>
        {error ? <div className="p-4"><Notice tone="destructive" title="Memory unavailable"><div className="flex flex-wrap items-center gap-2"><span>{error}</span><Button onClick={() => void load()} size="sm" variant="outline">Retry</Button></div></Notice></div> : null}
        {loading ? (
          <div aria-label="Loading memory state" className="mx-auto w-full max-w-3xl space-y-4 px-6 py-6">
            <div className="h-5 w-40 animate-pulse rounded bg-panel-raised" />
            <div className="h-16 animate-pulse rounded-md bg-panel-raised" />
            <div className="h-32 animate-pulse rounded-md bg-panel-raised" />
            <div className="grid grid-cols-2 gap-3"><div className="h-16 animate-pulse rounded-md bg-panel-raised" /><div className="h-16 animate-pulse rounded-md bg-panel-raised" /></div>
          </div>
        ) : null}
        {!loading && selected?.type === "config" && configDraft ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
            <div>
              <div className="flex items-center gap-2"><h2 className="text-sm font-semibold text-foreground">Workspace definition</h2><Pill tone="primary">Highest authority</Pill></div>
              <p className="mt-1 text-xs text-muted-foreground">This is explicit configuration, not learned memory. It wins whenever learned memory conflicts.</p>
            </div>
            <Field label="Name"><Input onChange={(event) => setConfigDraft({ ...configDraft, title: event.target.value })} value={configDraft.title} /></Field>
            <Field label="Identity, purpose, organization, and principles"><Textarea className="min-h-96 font-mono text-xs leading-6" onChange={(event) => setConfigDraft({ ...configDraft, body: event.target.value })} value={configDraft.body} /></Field>
            <div><Button icon="save" loading={saving} onClick={() => void saveConfig()}>Save definition</Button></div>
          </div>
        ) : null}

        {!loading && (selected?.type === "memory" || selected?.type === "new") ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
            <div className="flex items-start gap-2">
              <div><h2 className="text-sm font-semibold text-foreground">{selected.type === "new" ? "New learned memory" : "Learned memory"}</h2><p className="mt-1 text-xs text-muted-foreground">Only approved memories are eligible for retrieval. Every record keeps its reason and source.</p></div>
              {activeMemory ? <Pill className="ml-auto" tone={activeMemory.status === "approved" ? "success" : "default"}>{activeMemory.status}</Pill> : null}
            </div>
            {activeMemory?.status === "superseded" ? <Notice tone="warning" title="Superseded memory">This record remains for provenance but is excluded from retrieval.</Notice> : null}
            {activeMemory && activeMemory.conflictIds.length > 0 && activeMemory.status === "proposed" ? <Notice tone="warning" title="Possible contradiction">A current memory covers the same subject. Select the record this proposal supersedes before approving it.</Notice> : null}
            <div className="rounded-md border border-border bg-panel p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xs font-semibold text-foreground">Retrieval path</span>
                <Pill className="ml-auto" tone={memoryDraft.approved ? "success" : "default"}>{memoryDraft.approved ? "Eligible" : "Review required"}</Pill>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded bg-panel-raised px-2 py-2"><div className="text-xs font-semibold tabular-nums text-foreground">{Math.round(memoryDraft.confidence * 100)}%</div><div className="text-3xs text-muted-foreground">Confidence</div></div>
                <div className="rounded bg-panel-raised px-2 py-2"><div className="text-xs font-semibold text-foreground">{memoryDraft.scope}</div><div className="text-3xs text-muted-foreground">Scope</div></div>
                <div className="rounded bg-panel-raised px-2 py-2"><div className="text-xs font-semibold text-foreground">{memoryDraft.pinned ? "Pinned" : "Ranked"}</div><div className="text-3xs text-muted-foreground">Priority</div></div>
              </div>
            </div>
            <Field label="Title"><Input onChange={(event) => setMemoryDraft({ ...memoryDraft, title: event.target.value })} value={memoryDraft.title} /></Field>
            <Field label="What should be remembered?"><Textarea className="min-h-40" onChange={(event) => setMemoryDraft({ ...memoryDraft, body: event.target.value })} value={memoryDraft.body} /></Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Kind"><NativeSelect ariaLabel="Memory kind" onChange={(kind) => setMemoryDraft({ ...memoryDraft, kind: kind as MemoryKind })} options={[{ label: "Semantic fact or decision", value: "semantic" }, { label: "Episodic run outcome", value: "episodic" }]} value={memoryDraft.kind} /></Field>
              <Field label="Scope"><NativeSelect ariaLabel="Memory scope" onChange={(scope) => setMemoryDraft({ ...memoryDraft, scope: scope as MemoryScope })} options={[{ label: "Workspace", value: "workspace" }, { label: "User", value: "user" }, { label: "Role", value: "role" }, { label: "Workflow", value: "workflow" }]} value={memoryDraft.scope} /></Field>
              {memoryDraft.scope === "role" || memoryDraft.scope === "workflow" ? <Field label="Scope id"><Input onChange={(event) => setMemoryDraft({ ...memoryDraft, scopeId: event.target.value })} value={memoryDraft.scopeId} /></Field> : null}
              <Field hint="Controls retrieval ranking; approval still decides eligibility." label={`Confidence · ${Math.round(memoryDraft.confidence * 100)}%`}><input aria-label="Memory confidence" className="h-8 w-full cursor-pointer accent-accent" max={1} min={0} onChange={(event) => setMemoryDraft({ ...memoryDraft, confidence: Number(event.target.value) })} step={0.05} type="range" value={memoryDraft.confidence} /></Field>
            </div>
            <Field label="Why was this remembered?"><Input onChange={(event) => setMemoryDraft({ ...memoryDraft, reason: event.target.value })} value={memoryDraft.reason} /></Field>
            <Field label="Supersedes memory (optional)"><NativeSelect ariaLabel="Superseded memory" onChange={(supersedesId) => setMemoryDraft({ ...memoryDraft, supersedesId })} options={[{ label: "None", value: "" }, ...data.memories.filter((memory) => memory.id !== activeMemory?.id && memory.status !== "forgotten").map((memory) => ({ label: memory.title, value: memory.id }))]} value={memoryDraft.supersedesId} /></Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Approval"><ToggleRow checked={memoryDraft.approved} description={memoryDraft.approved ? "Approved for retrieval" : "Proposed; not retrieved"} onCheckedChange={(approved) => setMemoryDraft({ ...memoryDraft, approved })} /></Field>
              <Field label="Priority"><ToggleRow checked={memoryDraft.pinned} description={memoryDraft.pinned ? "Pinned above relevance ranking" : "Rank by relevance"} onCheckedChange={(pinned) => setMemoryDraft({ ...memoryDraft, pinned })} /></Field>
            </div>
            {activeMemory ? <div className="rounded-md bg-panel-raised p-3 text-xs text-muted-foreground"><div>Source: {activeMemory.provenance.sourceType}{activeMemory.provenance.sourceId ? ` · ${activeMemory.provenance.sourceId}` : ""}</div><div className="mt-1">Authority: {activeMemory.authority}</div><div className="mt-1">Updated: {new Date(activeMemory.updatedAt).toLocaleString()}</div></div> : null}
            <div className="flex items-center gap-2">
              <Button disabled={!memoryDraft.title.trim() || !memoryDraft.body.trim()} icon="save" loading={saving} onClick={() => void saveMemory()}>Save memory</Button>
              {activeMemory ? <Button className="ml-auto" onClick={() => void forget("forget")} variant="outline">Forget</Button> : null}
              {activeMemory ? <Button icon="trash" onClick={() => setRemoveOpen(true)} variant="danger">Remove</Button> : null}
            </div>
          </div>
        ) : null}

        {!loading && !selected ? <EmptyState description="Create a learned memory or select the workspace definition." icon="brain" title="No memory selected" /> : null}
      </section>

      <ConfirmDialog confirmLabel="Remove" description="This permanently removes the selected memory record and its retrieval provenance." onConfirm={() => void forget("remove")} onOpenChange={setRemoveOpen} open={removeOpen} title="Remove memory?" tone="destructive" />
    </div>
  );
}
