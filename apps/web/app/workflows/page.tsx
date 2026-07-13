"use client";

import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { useMemo, useState, useRef, useEffect } from "react";
import { Button, ConfirmDialog, EmptyState, Field, Input, ListItem, PageHeader, Pill, ToggleRow, Tooltip, cn, toast } from "@spielos/design-system";
import { useDirty } from "@spielos/design-system/hooks/use-dirty";
import { AppShell } from "../../components/app-shell";
import { SidebarListPanel } from "../../components/sidebar-list-panel";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import type { WorkstreamDefinition, WorkstreamNode } from "../../lib/workspace-data";
import { GraphCanvas } from "./graph-canvas";
import { NodeInspector, roleContractName } from "./node-inspector";
import { CANVAS_CONFIG, NODE_DIMENSIONS } from "./workflow-canvas-config";

function blankWorkstream(): Omit<WorkstreamDefinition, "id" | "orgId" | "createdAt" | "updatedAt"> {
  return {
    name: "New Workflow",
    description: "Custom role-based workflow.",
    status: "draft",
    nodes: [],
    edges: [],
    metadata: {}
  };
}

function computeNextPosition(nodes: WorkstreamNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 40, y: 40 };
  const last = nodes[nodes.length - 1];
  let nextX = last.position.x + NODE_DIMENSIONS.width + CANVAS_CONFIG.nodeGap;
  let nextY = last.position.y;
  if (nextX + NODE_DIMENSIONS.width > 1200) {
    nextX = 40;
    nextY = last.position.y + NODE_DIMENSIONS.height + CANVAS_CONFIG.nodeGap;
  }
  return { x: nextX, y: nextY };
}

export default function WorkflowsPage() {
  const store = useWorkspaceStore();
  const [selectedId, setSelectedId] = useState<string | null>(store.workflows[0]?.id ?? null);
  const selected = store.workflows.find((entry) => entry.id === selectedId) ?? null;
  const { draft, setDraft, dirty, reset, markSaved } = useDirty<WorkstreamDefinition | Omit<WorkstreamDefinition, "id" | "orgId" | "createdAt" | "updatedAt">>(
    selected ?? blankWorkstream()
  );
  const [query, setQuery] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fromNodeId, setFromNodeId] = useState<string | null>(null);
  const [runLog, setRunLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    if (!q) return store.workflows;
    return store.workflows.filter((workflow) =>
      [workflow.name, workflow.description].some((value) => value.toLowerCase().includes(q))
    );
  }, [query, store.workflows]);

  function selectWorkflow(workflow: WorkstreamDefinition) {
    setSelectedId(workflow.id);
    reset(workflow as unknown as Omit<WorkstreamDefinition, "id" | "orgId" | "createdAt" | "updatedAt">);
    setSelectedNodeId(null);
    setRunLog([]);
  }

  async function createWorkflow() {
    if (creating) return;
    setCreating(true);
    try {
      const created = await store.addWorkflow(blankWorkstream() as Parameters<typeof store.addWorkflow>[0]);
      setSelectedId(created.id);
      reset(created as unknown as Omit<WorkstreamDefinition, "id" | "orgId" | "createdAt" | "updatedAt">);
      setSelectedNodeId(null);
      setRunLog([]);
      toast.success("Workflow created");
    } catch {
      toast.error("Failed to create workflow");
    } finally {
      setCreating(false);
    }
  }

  async function save(): Promise<string | null> {
    setSaving(true);
    try {
      if (!selectedId) {
        const created = await store.addWorkflow(draft as Parameters<typeof store.addWorkflow>[0]);
        setSelectedId(created.id);
        reset(created);
        setSelectedNodeId(null);
        toast.success("Workflow created");
        return created.id;
      }
      await store.updateWorkflow(selectedId, draft as Partial<WorkstreamDefinition>);
      markSaved();
      toast.success("Workflow saved");
      return selectedId;
    } catch {
      toast.error("Failed to save workflow");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selectedId) return;
    const id = selectedId;
    try {
      await store.deleteWorkflow(id);
      const next = store.workflows.find((workflow) => workflow.id !== id);
      if (next) selectWorkflow(next);
      else {
        setSelectedId(null);
        reset(blankWorkstream());
        setSelectedNodeId(null);
        setRunLog([]);
      }
      toast.success("Workflow deleted");
    } catch {
      toast.error("Failed to delete workflow");
    }
  }

  function addRoleNode(roleId: string, x?: number, y?: number) {
    const role = store.roles.find((entry) => entry.id === roleId);
    if (!role || role.status !== "active") return;
    pushUndo();
    const pos = x !== undefined && y !== undefined ? { x, y } : computeNextPosition(draft.nodes);
    const node: WorkstreamNode = {
      id: `node_${crypto.randomUUID()}`,
      roleId,
      title: role.name,
      position: { x: pos.x, y: pos.y },
      skillIds: [],
      fileIds: [],
      inputContract: roleContractName(role, "inputs", "Role input"),
      outputContract: roleContractName(role, "outputs", "Role output")
    };
    setDraft((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeId(node.id);
    store.setInspectorOpen(true);
  }

  function addEvalNode(evalId: string, x?: number, y?: number) {
    const evalFile = store.evalFiles.find((entry) => entry.id === evalId);
    if (!evalFile || evalFile.status !== "active") return;
    pushUndo();
    const pos = x !== undefined && y !== undefined ? { x, y } : computeNextPosition(draft.nodes);
    const node: WorkstreamNode = {
      id: `node_${crypto.randomUUID()}`,
      roleId: "runtime.eval",
      title: `QA: ${evalFile.name}`,
      position: { x: pos.x, y: pos.y },
      skillIds: [evalFile.id],
      fileIds: [],
      inputContract: "previous_output",
      outputContract: "Eval report",
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

  async function runWorkflow() {
    if (draft.nodes.length === 0 || draft.status !== "active" || running) return;
    let workflowId = selectedId;
    if (dirty || !workflowId) {
      workflowId = await save();
      if (!workflowId) return;
    }
    setRunning(true);
    setRunLog([]);
    try {
      const allFileIds = new Set<string>();
      for (const node of draft.nodes) {
        for (const id of node.fileIds) allFileIds.add(id);
      }
      const response = await fetch("/api/runs/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Execute workflow "${draft.name}": ${draft.description}`,
          type: "workflow",
          workflowId,
          contextFileIds: Array.from(allFileIds)
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
              const nodeName = item.event.nodeTitle ?? "";
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
            } else if (item.kind === "done") {
              if (typeof item.message === "string" && item.message.trim()) {
                setRunLog((prev) => [...prev, item.message]);
              }
            }
          } catch { /* skip malformed */ }
        }
      }
      if (output.trim()) setRunLog((prev) => [...prev, output.trim().slice(0, 500)]);
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
        />

        <div className="flex min-h-0 flex-1">
          <SidebarListPanel
            title="Workflows"
            count={store.workflows.length}
            newBusy={creating}
            onNew={createWorkflow}
            newTooltip="New workflow"
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholder="Search workflows"
          >
            {filtered.length === 0 ? (
              <EmptyState className="py-10" description="No workflows match this search." title="No matches" />
            ) : (
              <ul className="grid gap-1">
                {filtered.map((workflow) => <ListItem
                  active={workflow.id === selectedId}
                  description={workflow.description}
                  icon={ENTITY_ICONS.workflow}
                  key={workflow.id}
                  metadata={<Pill>{workflow.nodes.length} steps</Pill>}
                  onClick={() => selectWorkflow(workflow)}
                  title={workflow.name}
                />)}
              </ul>
            )}
          </SidebarListPanel>
          <main className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span>Workflows</span>
                <Icon name="chevron-right" size={12} />
                <span className="max-w-72 truncate text-foreground">{draft.name}</span>
                <Pill tone={draft.status === "active" ? "success" : "default"}>
                  {draft.status === "active" ? "Enabled" : "Disabled"}
                </Pill>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  icon="play"
                  loading={running}
                  onClick={runWorkflow}
                  size="md"
                  variant="outline"
                  disabled={draft.nodes.length === 0 || draft.status !== "active"}
                >
                  Run
                </Button>
                {!isNew ? (
                  <Tooltip content="Delete workflow" side="bottom">
                    <Button aria-label="Delete workflow" icon="trash" onClick={() => setConfirmDelete(true)} size="icon-xs" variant="ghost" />
                  </Tooltip>
                ) : null}
                <Button disabled={!dirty} icon="save" loading={saving} onClick={save} size="md" variant={dirty ? "primary" : "outline"}>
                  Save
                </Button>
              </div>
            </div>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="grid w-full shrink-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--editor-field-min)),1fr))] items-end gap-3 border-b border-border bg-panel-raised px-4 py-3">
                  <Field label="Workflow name">
                    <Input
                      className="h-8 text-sm font-medium"
                      onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
                      value={draft.name}
                    />
                  </Field>
                  <Field label="Enabled">
                    <ToggleRow
                      checked={draft.status === "active"}
                      description={draft.status === "active" ? "Can run" : "Cannot run"}
                      onCheckedChange={(checked) => setDraft((current) => ({ ...current, status: checked ? "active" : "draft" }))}
                    />
                  </Field>
                </div>
                <div className="flex h-10 w-full shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3">
                  <span className="mr-2 shrink-0 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                  <div className="border-t border-border bg-panel-raised px-4 py-2 text-2xs text-muted-foreground">
                    {runLog.join("  ·  ")}
                  </div>
                ) : null}
              </div>
            </section>
          </main>
        </div>
        <ConfirmDialog
          confirmLabel="Delete workflow"
          description={`Runs will no longer be able to execute ${draft.name}. Existing run history is not changed.`}
          onConfirm={async () => {
            setConfirmDelete(false);
            await remove();
          }}
          onOpenChange={setConfirmDelete}
          open={confirmDelete}
          title={`Delete ${draft.name}?`}
        />
      </div>
    </AppShell>
  );
}
