"use client";

import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { InspectorToggle } from "../../components/inspector-toggle";
import { useMemo, useState, useRef, useEffect } from "react";
import { Button, EmptyState, Field, Input, PageHeader, Pill, SearchInput, Switch, Tooltip, cn, toast } from "@spielos/design-system";
import { useDirty } from "@spielos/design-system/hooks/use-dirty";
import { AppShell } from "../../components/app-shell";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import type { WorkstreamDefinition, WorkstreamNode } from "../../lib/workspace-data";
import { GraphCanvas } from "./graph-canvas";
import { NodeInspector, roleContractName } from "./node-inspector";

function blankWorkstream(): Omit<WorkstreamDefinition, "id" | "updatedAt"> {
  return { title: "New Workflow", description: "Custom role-based workflow.", status: "draft", nodes: [], edges: [] };
}

export default function WorkflowsPage() {
  const store = useWorkspaceStore();
  const [selectedId, setSelectedId] = useState<string | null>(store.workstreams[0]?.id ?? null);
  const selected = store.workstreams.find((entry) => entry.id === selectedId) ?? null;
  const { draft, setDraft, dirty, reset, markSaved } = useDirty<WorkstreamDefinition | Omit<WorkstreamDefinition, "id" | "updatedAt">>(
    selected ?? blankWorkstream()
  );
  const [query, setQuery] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fromNodeId, setFromNodeId] = useState<string | null>(null);
  const [runLog, setRunLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const isNew = selectedId === null;

  function pushUndo() {
    undoStack.current.push(JSON.stringify({ nodes: draft.nodes, edges: draft.edges }));
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }

  function undo() {
    if (undoStack.current.length === 0) return;
    redoStack.current.push(JSON.stringify({ nodes: draft.nodes, edges: draft.edges }));
    const prev = JSON.parse(undoStack.current.pop()!);
    setDraft((current) => ({ ...current, nodes: prev.nodes, edges: prev.edges }));
  }

  function redo() {
    if (redoStack.current.length === 0) return;
    undoStack.current.push(JSON.stringify({ nodes: draft.nodes, edges: draft.edges }));
    const next = JSON.parse(redoStack.current.pop()!);
    setDraft((current) => ({ ...current, nodes: next.nodes, edges: next.edges }));
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Z") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const selectedNode = draft.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const files = store.items.filter((item) =>
    ["knowledge", "strategy", "library", "prompts"].includes(item.kind) && item.status !== "archived"
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.workstreams;
    return store.workstreams.filter((workstream) =>
      [workstream.title, workstream.description].some((value) => value.toLowerCase().includes(q))
    );
  }, [query, store.workstreams]);

  function selectWorkstream(workstream: WorkstreamDefinition) {
    setSelectedId(workstream.id);
    reset(workstream);
    setSelectedNodeId(null);
    setRunLog([]);
  }

  function createWorkstream() {
    const next = blankWorkstream();
    setSelectedId(null);
    reset(next);
    setSelectedNodeId(null);
    setRunLog([]);
  }

  async function save() {
    setSaving(true);
    try {
      if (isNew) {
        const created = store.addWorkstream(draft as Omit<WorkstreamDefinition, "id" | "updatedAt">);
        setSelectedId(created.id);
        reset(created);
        toast.success("Workflow created");
      } else {
        store.updateWorkstream((draft as WorkstreamDefinition).id, draft as Partial<WorkstreamDefinition>);
        markSaved();
        toast.success("Workflow saved");
      }
    } catch {
      toast.error("Failed to save workflow");
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    if (isNew) return;
    store.deleteWorkstream((draft as WorkstreamDefinition).id);
    createWorkstream();
  }

  function addRoleNode(roleId: string, x?: number, y?: number) {
    const role = store.roles.find((entry) => entry.id === roleId);
    if (!role || role.status !== "active") return;
    pushUndo();
    const node: WorkstreamNode = {
      id: `node_${crypto.randomUUID()}`,
      nodeType: "role",
      roleId,
      title: role.name,
      x: x ?? 0,
      y: y ?? 0,
      prompt: "",
      skillIds: [],
      fileIds: [],
      input: roleContractName(role, "inputs", "Role input"),
      output: roleContractName(role, "outputs", "Role output")
    };
    setDraft((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeId(node.id);
    store.setInspectorOpen(true);
  }

  function addEvalNode(evalId: string, x?: number, y?: number) {
    const evalFile = store.evalFiles.find((entry) => entry.id === evalId);
    if (!evalFile || evalFile.status !== "active") return;
    pushUndo();
    const node: WorkstreamNode = {
      id: `node_${crypto.randomUUID()}`,
      nodeType: "eval",
      roleId: "runtime.eval",
      title: `QA: ${evalFile.name}`,
      x: x ?? 0,
      y: y ?? 0,
      prompt: "",
      skillIds: [evalFile.id],
      fileIds: [],
      input: "previous_output",
      output: "Eval report",
      loopConfig: { ...evalFile.loopConfig, evalId: evalFile.id },
      evalInput: { type: "previous_output" }
    };
    setDraft((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeId(node.id);
    store.setInspectorOpen(true);
  }

  function addStep(type: "role" | "eval", id: string, x?: number, y?: number) {
    if (type === "eval") addEvalNode(id, x, y);
    else addRoleNode(id, x, y);
  }

  function updateNode(nodeId: string, patch: Partial<WorkstreamNode>) {
    pushUndo();
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))
    }));
  }

  function deleteNode(nodeId: string) {
    pushUndo();
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
    }));
    setSelectedNodeId((current) => (current === nodeId ? null : current));
  }

  function connectNode(targetId: string) {
    if (!fromNodeId || fromNodeId === targetId) {
      setFromNodeId(targetId);
      return;
    }
    const src = fromNodeId;
    pushUndo();
    setDraft((current) =>
      current.edges.some((edge) => edge.source === src && edge.target === targetId)
        ? current
        : { ...current, edges: [...current.edges, { id: `edge_${src}_${targetId}`, source: src, target: targetId }] }
    );
    setFromNodeId(null);
  }

  function addEdge(sourceId: string, targetId: string) {
    pushUndo();
    setDraft((current) =>
      current.edges.some((edge) => edge.source === sourceId && edge.target === targetId)
        ? current
        : { ...current, edges: [...current.edges, { id: `edge_${sourceId}_${targetId}`, source: sourceId, target: targetId }] }
    );
    setFromNodeId(null);
  }

  function removeEdge(edgeId: string) {
    pushUndo();
    setDraft((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.id !== edgeId)
    }));
  }

  function toggleNodeList(nodeId: string, key: "skillIds" | "fileIds", value: string) {
    const node = draft.nodes.find((entry) => entry.id === nodeId);
    if (!node) return;
    const exists = node[key].includes(value);
    updateNode(nodeId, {
      [key]: exists ? node[key].filter((id) => id !== value) : [...node[key], value]
    } as Partial<WorkstreamNode>);
  }

  function getTopologicalOrder(): WorkstreamNode[] {
    const nodeMap = new Map(draft.nodes.map((n) => [n.id, n]));
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    for (const node of draft.nodes) {
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }
    for (const edge of draft.edges) {
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
      adjacency.get(edge.source)?.push(edge.target);
    }
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }
    const sorted: WorkstreamNode[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = nodeMap.get(id);
      if (node) sorted.push(node);
      for (const neighbor of adjacency.get(id) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }
    for (const node of draft.nodes) {
      if (!sorted.some((n) => n.id === node.id)) sorted.push(node);
    }
    return sorted;
  }

  async function runWorkflow() {
    if (draft.nodes.length === 0 || draft.status !== "active" || running) return;
    setRunning(true);
    setRunLog(["Starting workflow execution..."]);
    try {
      const ordered = getTopologicalOrder();
      const allFileIds = new Set<string>();
      const nodesPayload = ordered.map((node) => {
        for (const id of node.fileIds) allFileIds.add(id);
        return {
          id: node.id,
          nodeType: node.nodeType ?? "role",
          roleId: node.roleId,
          title: node.title,
          promptOverride: node.prompt || undefined,
          skillIds: node.skillIds,
          fileIds: node.fileIds,
          loopConfig: node.loopConfig,
          evalInput: node.evalInput
        };
      });
      const response = await fetch("/api/runs/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Execute workflow "${draft.title}": ${draft.description}`,
          contextRefs: Array.from(allFileIds).map((id) => ({ id, kind: "knowledge" })),
          target: "id" in draft ? { type: "workflow", id: draft.id } : undefined,
          nodes: nodesPayload
        })
      });
      if (!response.ok || !response.body) {
        setRunLog((prev) => [...prev, `Run FAILED (HTTP ${response.status})`]);
        setRunning(false);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let output = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          try {
            const item = JSON.parse(line.slice(6));
            if (item.kind === "event") {
              const nodeName = item.event.node ?? "";
              const stepLabel = nodeName ? `${nodeName}: ${item.event.message}` : item.event.message;
              setRunLog((prev) => {
                if (prev[prev.length - 1] === stepLabel) return prev;
                return [...prev, stepLabel];
              });
            } else if (item.kind === "artifact" && item.artifact?.body) {
              output = item.artifact.body;
              setRunLog((prev) => [...prev, `Artifact: ${item.artifact.title}`]);
            } else if (item.kind === "text" && typeof item.text === "string") {
              output += item.text;
            } else if (item.kind === "error") {
              setRunLog((prev) => [...prev, `Error: ${item.message}`]);
            }
          } catch { /* skip malformed */ }
        }
      }
      setRunLog((prev) => [...prev, `Workflow complete.${output ? `\n\n${output.trim().slice(0, 500)}` : ""}`]);
    } catch (error) {
      setRunLog((prev) => [...prev, `ERROR: ${error instanceof Error ? error.message : "unknown"}`]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <AppShell
      inspector={
        selectedNode ? (
          <NodeInspector
            files={files}
            node={selectedNode}
            nodes={draft.nodes}
            evals={store.evalFiles}
            roles={store.roles}
            skills={store.skills}
            toggleNodeList={toggleNodeList}
            updateNode={updateNode}
          />
        ) : undefined
      }
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name={ENTITY_ICONS.workflow} size={14} />}
          title="Workflows"
          actions={
            <>
              <div className="hidden w-80 md:block">
                <SearchInput placeholder="Search workflows" value={query} onChange={setQuery} />
              </div>
              <InspectorToggle label="Open settings panel" />
            </>
          }
        />
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-background">
            <div className="border-b border-border p-3 md:hidden">
              <SearchInput placeholder="Search workflows" value={query} onChange={setQuery} />
            </div>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Workflows
              </span>
              <Pill className="ml-auto">{store.workstreams.length}</Pill>
              <Tooltip content="New workflow" side="bottom">
                <Button aria-label="New workflow" className="h-7 px-2" onClick={createWorkstream} size="sm" variant="ghost">
                  <Icon name="plus" size={14} />
                  <span className="ml-1 text-xs">New</span>
                </Button>
              </Tooltip>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <EmptyState className="py-10" description="No workflows match this search." title="No matches" />
              ) : (
                <ul className="grid gap-1">
                  {filtered.map((workstream) => (
                    <li key={workstream.id}>
                      <button
                        className={cn(
                          "w-full rounded-md border px-2 py-2 text-left transition-colors",
                          workstream.id === selectedId ? "border-border bg-selected" : "border-transparent hover:border-border hover:bg-hover"
                        )}
                        onClick={() => selectWorkstream(workstream)}
                        type="button"
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{workstream.title}</span>
                          <Pill className="ml-auto">{workstream.nodes.length} steps</Pill>
                        </div>
                        <p className="line-clamp-2 text-[11px] text-muted-foreground">{workstream.description}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
          <main className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span>Workflows</span>
                <Icon name="chevron-right" size={12} />
                <span className="max-w-72 truncate text-foreground">{draft.title}</span>
                <Pill tone={draft.status === "active" ? "success" : "default"}>
                  {draft.status === "active" ? "enabled" : "disabled"}
                </Pill>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  onClick={runWorkflow}
                  size="md"
                  variant="outline"
                  disabled={running || draft.nodes.length === 0 || draft.status !== "active"}
                >
                  {running ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="play" size={14} />}
                  {running ? "Running..." : "Run"}
                </Button>
                {!isNew ? (
                  <Tooltip content="Delete workflow" side="bottom">
                    <Button aria-label="Delete workflow" onClick={remove} size="icon" variant="ghost">
                      <Icon name="trash" size={14} />
                    </Button>
                  </Tooltip>
                ) : null}
                <Button disabled={!dirty || saving} onClick={save} size="md" variant={dirty ? "primary" : "outline"}>
                  {saving ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="save" size={14} />}
                  Save
                </Button>
              </div>
            </div>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="grid w-full shrink-0 items-end gap-3 border-b border-border bg-panel-raised px-4 py-3 xl:grid-cols-[minmax(0,1fr)_180px]">
                  <Field label="Workflow name">
                    <Input
                      className="h-8 text-sm font-medium"
                      onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))}
                      value={draft.title}
                    />
                  </Field>
                  <Field label="Enabled">
                    <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
                      <Switch
                        checked={draft.status === "active"}
                        onCheckedChange={(checked) => setDraft((current) => ({ ...current, status: checked ? "active" : "draft" }))}
                      />
                      <span>{draft.status === "active" ? "Can run" : "Cannot run"}</span>
                    </label>
                  </Field>
                </div>
                <div className="flex h-11 w-full shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3">
                  <span className="mr-2 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Steps
                  </span>
                  {store.roles.map((role) => {
                    const disabled = role.status !== "active";
                    return (
                      <Button
                        className={cn("h-7 shrink-0", disabled && "opacity-45")}
                        disabled={disabled}
                        draggable={!disabled}
                        key={role.id}
                        onClick={() => addRoleNode(role.id)}
                        onDragStart={(e) => {
                          if (disabled) return;
                          e.dataTransfer.setData("application/spielos-step", JSON.stringify({ type: "role", id: role.id }));
                          e.dataTransfer.setData("text/plain", `role:${role.id}`);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <Icon name="plus" size={14} />
                        {role.name}
                      </Button>
                    );
                  })}
                  {store.evalFiles.filter((evalFile) => evalFile.status === "active").map((evalFile) => (
                    <Button
                      className="h-7 shrink-0"
                      draggable
                      key={evalFile.id}
                      onClick={() => addEvalNode(evalFile.id)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/spielos-step", JSON.stringify({ type: "eval", id: evalFile.id }));
                        e.dataTransfer.setData("text/plain", `eval:${evalFile.id}`);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      <Icon name="bar-chart" size={14} />
                      QA: {evalFile.name}
                    </Button>
                  ))}
                </div>
                <GraphCanvas
                  draft={draft}
                  evalsById={new Map(store.evalFiles.map((evalFile) => [evalFile.id, evalFile.name]))}
                  rolesById={new Map(store.roles.map((role) => [role.id, role.name]))}
                  fromNodeId={fromNodeId}
                  updateNode={updateNode}
                  addEdge={addEdge}
                  deleteNode={deleteNode}
                  removeEdge={removeEdge}
                  connectNode={connectNode}
                  setSelectedNodeId={(nodeId) => {
                    setSelectedNodeId(nodeId);
                    store.setInspectorOpen(true);
                  }}
                  setFromNodeId={setFromNodeId}
                  addStep={addStep}
                />
                {runLog.length ? (
                  <div className="border-t border-border bg-panel-raised px-4 py-2 text-[11px] text-muted-foreground">
                    {runLog.join("  ·  ")}
                  </div>
                ) : null}
              </div>
            </section>
          </main>
        </div>
      </div>
    </AppShell>
  );
}
