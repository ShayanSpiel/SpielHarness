"use client";

import { Icon } from "../../components/icons";
import { InspectorToggle } from "../../components/inspector-toggle";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Button,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Pill,
  SearchInput,
  Textarea,
  Tooltip,
  cn,
  toast
} from "@spielos/design-system";
import { useDirty } from "@spielos/design-system/hooks/use-dirty";
import { AppShell } from "../../components/app-shell";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import type { SkillDefinition, WorkstreamDefinition, WorkstreamNode } from "../../lib/workspace-data";

function blankWorkstream(): Omit<WorkstreamDefinition, "id" | "updatedAt"> {
  return {
    title: "New Workflow",
    description: "Custom role-based workflow.",
    status: "draft",
    nodes: [],
    edges: []
  };
}

export default function WorkstreamsPage() {
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
  const isNew = selectedId === null;

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

  function addNode(roleId: string, x?: number, y?: number) {
    const role = store.roles.find((entry) => entry.id === roleId);
    if (!role || role.status !== "active") return;
    const node: WorkstreamNode = {
      id: `node_${crypto.randomUUID()}`,
      roleId,
      title: role.name,
      x: x ?? (80 + draft.nodes.length * 220),
      y: y ?? (120 + (draft.nodes.length % 2) * 120),
      prompt: "",
      skillIds: [],
      fileIds: [],
      input: role.inputArtifactTypes[0] ?? "input",
      output: role.outputArtifactTypes[0] ?? "output"
    };
    setDraft((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeId(node.id);
    store.setInspectorOpen(true);
  }

  function updateNode(nodeId: string, patch: Partial<WorkstreamNode>) {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))
    }));
  }

  function deleteNode(nodeId: string) {
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
    setDraft((current) =>
      current.edges.some((edge) => edge.source === src && edge.target === targetId)
        ? current
        : {
            ...current,
            edges: [...current.edges, { id: `edge_${src}_${targetId}`, source: src, target: targetId }]
          }
    );
    setFromNodeId(null);
  }

  function addEdge(sourceId: string, targetId: string) {
    setDraft((current) =>
      current.edges.some((edge) => edge.source === sourceId && edge.target === targetId)
        ? current
        : {
            ...current,
            edges: [...current.edges, { id: `edge_${sourceId}_${targetId}`, source: sourceId, target: targetId }]
          }
    );
    setFromNodeId(null);
  }

  function removeEdge(edgeId: string) {
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
    if (draft.nodes.length === 0 || running) return;

    setRunning(true);
    setRunLog(["Starting workflow execution..."]);

    try {
      const ordered = getTopologicalOrder();
      const allFileIds = new Set<string>();
      const nodesPayload = ordered.map((node) => {
        for (const id of node.fileIds) allFileIds.add(id);
        if (node.roleId) allFileIds.add(node.roleId);
        return {
          id: node.id,
          roleId: node.roleId,
          title: node.title,
          promptOverride: node.prompt || undefined,
          skillIds: node.skillIds,
          fileIds: node.fileIds
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
              const stepLabel = nodeName
                ? `${nodeName}: ${item.event.message}`
                : item.event.message;
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
          } catch {
            /* skip malformed */
          }
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
          icon={<Icon name="git-branch" size={14} />}
          title="Workstreams"
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
                          workstream.id === selectedId
                            ? "border-border bg-selected"
                            : "border-transparent hover:border-border hover:bg-hover"
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
                <span>Workstreams</span>
                 <Icon name="chevron-right" size={12} />
                <span className="max-w-72 truncate text-foreground">{draft.title}</span>
                <Pill tone={draft.status === "active" ? "success" : "default"}>{draft.status}</Pill>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  onClick={runWorkflow}
                  size="md"
                  variant="outline"
                  disabled={running || draft.nodes.length === 0 || draft.status !== "active"}
                >
                  {running ? (
                    <Icon name="loader" size={14} className="animate-spin" />
                  ) : (
                    <Icon name="play" size={14} />
                  )}
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

            <section className="flex min-h-0 flex-1">
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="grid shrink-0 gap-3 border-b border-border bg-panel-raised px-4 py-3 xl:grid-cols-[minmax(0,1fr)_140px]">
                  <Field label="Workflow name">
                    <Input
                      className="h-8 text-sm font-medium"
                      onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))}
                      value={draft.title}
                    />
                  </Field>
                  <Field label="Status">
                    <NativeSelect
                      ariaLabel="Workflow status"
                      onChange={(value) => setDraft((current) => ({ ...current, status: value as WorkstreamDefinition["status"] }))}
                      options={["active", "draft", "archived"].map((value) => ({ label: value, value }))}
                      value={draft.status}
                    />
                  </Field>
                </div>
                <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3">
                  <span className="mr-2 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Roles
                  </span>
                  {store.roles.map((role) => {
                    const disabled = role.status !== "active";
                    return (
                      <Button
                        className={cn("h-7 shrink-0", disabled && "opacity-45")}
                        disabled={disabled}
                        draggable={!disabled}
                        key={role.id}
                        onClick={() => addNode(role.id)}
                        onDragStart={(e) => {
                          if (disabled) return;
                          e.dataTransfer.setData("text/plain", role.id);
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
                </div>
                <GraphCanvas
                  addNode={addNode}
                  addEdge={addEdge}
                  connectNode={connectNode}
                  deleteNode={deleteNode}
                  draft={draft}
                  fromNodeId={fromNodeId}
                  removeEdge={removeEdge}
                  rolesById={new Map(store.roles.map((role) => [role.id, role.name]))}
                  selectedNodeId={selectedNodeId}
                  setFromNodeId={setFromNodeId}
                  setSelectedNodeId={(nodeId) => {
                    setSelectedNodeId(nodeId);
                    store.setInspectorOpen(true);
                  }}
                  updateNode={updateNode}
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

function GraphCanvas({
  addNode,
  addEdge,
  connectNode,
  deleteNode,
  draft,
  fromNodeId,
  removeEdge,
  rolesById,
  selectedNodeId,
  setFromNodeId,
  setSelectedNodeId,
  updateNode
}: {
  addNode: (roleId: string, x?: number, y?: number) => void;
  addEdge: (sourceId: string, targetId: string) => void;
  connectNode: (targetId: string) => void;
  deleteNode: (nodeId: string) => void;
  draft: WorkstreamDefinition | Omit<WorkstreamDefinition, "id" | "updatedAt">;
  fromNodeId: string | null;
  removeEdge: (edgeId: string) => void;
  rolesById: Map<string, string>;
  selectedNodeId: string | null;
  setFromNodeId: (id: string | null) => void;
  setSelectedNodeId: (nodeId: string) => void;
  updateNode: (nodeId: string, patch: Partial<WorkstreamNode>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [panning, setPanning] = useState<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const [edgeDrag, setEdgeDrag] = useState<{ sourceId: string; mouseX: number; mouseY: number } | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const edgeDragConnectedRef = useRef<string[]>([]);
  const initialized = useRef(false);

  const CANVAS_SIZE = 10000;
  const GRID_SPACING = 32;
  const NODE_HEIGHT = 134;
  const NODE_WIDTH = 208;

  const zoomLevels = useMemo(() => [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0], []);
  const maxZoomIndex = useMemo(() => zoomLevels.length - 1, [zoomLevels]);

  useEffect(() => {
    if (!containerRef.current || initialized.current) return;
    initialized.current = true;
    const rect = containerRef.current.getBoundingClientRect();
    if (draft.nodes.length === 0) {
      const cx = CANVAS_SIZE / 2 - rect.width / 2;
      const cy = CANVAS_SIZE / 2 - rect.height / 2;
      setPan(clampPan(-cx, -cy, 1));
      return;
    }
    const minX = Math.min(...draft.nodes.map((n) => n.x));
    const maxX = Math.max(...draft.nodes.map((n) => n.x + NODE_WIDTH));
    const minY = Math.min(...draft.nodes.map((n) => n.y));
    const maxY = Math.max(...draft.nodes.map((n) => n.y + NODE_HEIGHT));
    const graphW = maxX - minX;
    const graphH = maxY - minY;
    const margin = 80;
    const fitZoom = Math.min((rect.width - margin * 2) / graphW, (rect.height - margin * 2) / graphH, 1);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    setZoom(fitZoom);
    setPan(clampPan(rect.width / 2 - centerX * fitZoom, rect.height / 2 - centerY * fitZoom, fitZoom));
  }, [draft.nodes]);

  function clampPan(x: number, y: number, currentZoom: number): { x: number; y: number } {
    const viewW = containerRef.current?.clientWidth ?? 1200;
    const viewH = containerRef.current?.clientHeight ?? 800;
    const scaledSize = CANVAS_SIZE * currentZoom;
    const margin = viewW * 0.3;
    return {
      x: Math.min(margin, Math.max(viewW - scaledSize - margin, x)),
      y: Math.min(margin, Math.max(viewH - scaledSize - margin, y))
    };
  }

  const handleWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    setZoom((prev) => {
      const prevIndex = zoomLevels.reduce((best, level, i) =>
        Math.abs(level - prev) < Math.abs(zoomLevels[best] - prev) ? i : best, 0
      );
      const direction = event.deltaY > 0 ? -1 : 1;
      const nextIndex = Math.min(maxZoomIndex, Math.max(0, prevIndex + direction));
      const newZoom = zoomLevels[nextIndex];
      const scale = newZoom / prev;
      const newPan = clampPan(
        mouseX - (mouseX - pan.x) * scale,
        mouseY - (mouseY - pan.y) * scale,
        newZoom
      );
      setPan(newPan);
      return newZoom;
    });
  }, [pan.x, pan.y, zoomLevels, maxZoomIndex]);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    if (event.target === event.currentTarget || (event.target as HTMLElement).dataset.canvas === "true") {
      setPanning({
        startX: event.clientX,
        startY: event.clientY,
        startPanX: pan.x,
        startPanY: pan.y
      });
      setSelectedNodeId("");
      setSelectedEdgeId(null);
    }
  }, [pan.x, pan.y, setSelectedNodeId]);

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (panning) {
      const dx = event.clientX - panning.startX;
      const dy = event.clientY - panning.startY;
      setPan(clampPan(panning.startPanX + dx, panning.startPanY + dy, zoom));
      return;
    }

    if (edgeDrag && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setEdgeDrag((prev) => prev ? { ...prev, mouseX: event.clientX - rect.left, mouseY: event.clientY - rect.top } : null);
      return;
    }

    if (dragging && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const canvasX = (event.clientX - rect.left - pan.x) / zoom;
      const canvasY = (event.clientY - rect.top - pan.y) / zoom;
      updateNode(dragging.id, {
        x: Math.max(24, Math.min(CANVAS_SIZE - NODE_WIDTH - 24, canvasX - dragging.dx)),
        y: Math.max(24, Math.min(CANVAS_SIZE - NODE_HEIGHT - 24, canvasY - dragging.dy))
      });
    }
  }, [panning, dragging, edgeDrag, pan.x, pan.y, zoom, updateNode]);

  const handlePointerUp = useCallback((event: React.PointerEvent) => {
    if (edgeDrag && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const canvasX = (event.clientX - rect.left - pan.x) / zoom;
      const canvasY = (event.clientY - rect.top - pan.y) / zoom;
      const targetNode = draft.nodes.find((n) => {
        if (n.id === edgeDrag.sourceId) return false;
        return canvasX >= n.x - 16 && canvasX <= n.x + NODE_WIDTH + 16 && canvasY >= n.y && canvasY <= n.y + NODE_HEIGHT;
      });
      if (targetNode) {
        addEdge(edgeDrag.sourceId, targetNode.id);
      } else {
        for (const eid of edgeDragConnectedRef.current) removeEdge(eid);
      }
      setFromNodeId(null);
      edgeDragConnectedRef.current = [];
      setEdgeDrag(null);
    }
    setPanning(null);
    setDragging(null);
  }, [edgeDrag, pan.x, pan.y, zoom, draft.nodes, addEdge, removeEdge, setFromNodeId]);

  function nodePointerDown(event: React.PointerEvent, node: WorkstreamNode) {
    if ((event.target as HTMLElement).closest('[data-port="true"]')) return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const canvasX = (event.clientX - rect.left - pan.x) / zoom;
    const canvasY = (event.clientY - rect.top - pan.y) / zoom;
    setDragging({ id: node.id, dx: canvasX - node.x, dy: canvasY - node.y });
    setSelectedNodeId(node.id);
  }

  function edgePortPointerDown(event: React.PointerEvent, node: WorkstreamNode) {
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    edgeDragConnectedRef.current = draft.edges.filter((e) => e.source === node.id).map((e) => e.id);
    setEdgeDrag({
      sourceId: node.id,
      mouseX: event.clientX - rect.left,
      mouseY: event.clientY - rect.top
    });
    setFromNodeId(node.id);
  }

  function zoomIn() {
    setZoom((prev) => {
      const prevIndex = zoomLevels.reduce((max, level, i) =>
        Math.abs(level - prev) < Math.abs(zoomLevels[max] - prev) ? i : max, 0
      );
      const nextIndex = Math.min(maxZoomIndex, prevIndex + 1);
      return zoomLevels[nextIndex];
    });
  }

  function zoomOut() {
    setZoom((prev) => {
      const prevIndex = zoomLevels.reduce((max, level, i) =>
        Math.abs(level - prev) < Math.abs(zoomLevels[max] - prev) ? i : max, 0
      );
      const nextIndex = Math.max(0, prevIndex - 1);
      return zoomLevels[nextIndex];
    });
  }

  function resetView() {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (draft.nodes.length === 0) {
      setZoom(1);
      setPan(clampPan(-(CANVAS_SIZE / 2 - rect.width / 2), -(CANVAS_SIZE / 2 - rect.height / 2), 1));
      return;
    }
    const minX = Math.min(...draft.nodes.map((n) => n.x));
    const maxX = Math.max(...draft.nodes.map((n) => n.x + NODE_WIDTH));
    const minY = Math.min(...draft.nodes.map((n) => n.y));
    const maxY = Math.max(...draft.nodes.map((n) => n.y + NODE_HEIGHT));
    const graphW = maxX - minX;
    const graphH = maxY - minY;
    const margin = 40;
    const fitZoom = Math.min((rect.width - margin * 2) / graphW, (rect.height - margin * 2) / graphH, 1);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    setZoom(fitZoom);
    setPan(clampPan(rect.width / 2 - centerX * fitZoom, rect.height / 2 - centerY * fitZoom, fitZoom));
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    const roleId = event.dataTransfer.getData("text/plain");
    if (!roleId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(24, (event.clientX - rect.left - pan.x) / zoom - NODE_WIDTH / 2);
    const y = Math.max(24, (event.clientY - rect.top - pan.y) / zoom - 22);
    addNode(roleId, x, y);
  }

  function renderEdgePath(source: WorkstreamNode, target: WorkstreamNode) {
    const x1 = source.x + NODE_WIDTH;
    const y1 = source.y + NODE_HEIGHT / 2;
    const x2 = target.x;
    const y2 = target.y + NODE_HEIGHT / 2;
    const dx = Math.abs(x2 - x1);
    const controlOffset = Math.max(40, dx * 0.45);
    return `M ${x1} ${y1} C ${x1 + controlOffset} ${y1}, ${x2 - controlOffset} ${y2}, ${x2} ${y2}`;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-background cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        ref={containerRef}
        style={{ touchAction: "none" }}
      >
        <div
          className="absolute"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            willChange: "transform",
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            transformOrigin: "0 0"
          }}
        >
          <div
            className="absolute inset-0"
            data-canvas="true"
            style={{
              backgroundImage: [
                `linear-gradient(var(--border) 1px, transparent 1px)`,
                `linear-gradient(90deg, var(--border) 1px, transparent 1px)`
              ].join(", "),
              backgroundSize: `${GRID_SPACING}px ${GRID_SPACING}px`,
              backgroundPosition: `0px 0px`
            }}
          />
          <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M 0 0 L 9 3.5 L 0 7 Z" fill="var(--foreground-muted)" stroke="var(--foreground-muted)" strokeWidth="0.5" strokeLinejoin="round" />
              </marker>
            </defs>
            {draft.edges.map((edge) => {
              const source = draft.nodes.find((n) => n.id === edge.source);
              const target = draft.nodes.find((n) => n.id === edge.target);
              if (!source || !target) return null;
              const path = renderEdgePath(source, target);
              const isActive = hoveredEdge === edge.id || selectedEdgeId === edge.id;
              const midX = (source.x + target.x) / 2 + 40;
              const midY = (source.y + target.y) / 2 + 28;
              return (
                <g key={edge.id}>
                  <path
                    d={path}
                    fill="none"
                    markerEnd="url(#arrowhead)"
                    stroke={isActive ? "var(--ring)" : "var(--foreground-muted)"}
                    strokeWidth={isActive ? 2.5 : 1.5}
                    style={{
                      transition: "stroke 120ms ease, stroke-width 120ms ease",
                      filter: isActive ? "brightness(1.2)" : "none"
                    }}
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    style={{ cursor: "pointer", pointerEvents: "stroke" }}
                    onPointerEnter={() => setHoveredEdge(edge.id)}
                    onPointerLeave={() => setHoveredEdge(null)}
                    onClick={(e) => { e.stopPropagation(); setSelectedEdgeId(selectedEdgeId === edge.id ? null : edge.id); }}
                  />
                  {isActive && (
                    <foreignObject x={midX} y={midY} width={52} height={22}>
                      <button
                        className="flex h-full w-full items-center justify-center gap-1 rounded-sm border border-border bg-panel text-[10px] text-muted-foreground hover:bg-hover hover:text-foreground transition-colors"
                        onClick={() => { removeEdge(edge.id); setSelectedEdgeId(null); }}
                        type="button"
                      >
                        <Icon name="x" size={10} />
                        Remove
                      </button>
                    </foreignObject>
                  )}
                </g>
              );
            })}
            {edgeDrag && (() => {
              const source = draft.nodes.find((n) => n.id === edgeDrag.sourceId);
              if (!source) return null;
              const x1 = source.x + NODE_WIDTH;
              const y1 = source.y + NODE_HEIGHT / 2;
              const canvasMX = (edgeDrag.mouseX - pan.x) / zoom;
              const canvasMY = (edgeDrag.mouseY - pan.y) / zoom;
              const dx = Math.abs(canvasMX - x1);
              const control = Math.max(40, dx * 0.4);
              return (
                <path
                  d={`M ${x1} ${y1} C ${x1 + control} ${y1}, ${canvasMX - control} ${canvasMY}, ${canvasMX} ${canvasMY}`}
                  fill="none"
                  stroke="var(--ring)"
                  strokeDasharray="6 3"
                  strokeWidth={2}
                />
              );
            })()}
          </svg>
          {draft.nodes.length === 0 ? (
            <EmptyState
              className="absolute inset-0"
              description="Add roles from the sidebar or drag a role onto the canvas."
              title="No steps yet"
            />
          ) : null}
          {draft.nodes.map((node) => {
            const role = rolesById.get(node.roleId);
            return (
              <div
                key={node.id}
                className={cn(
                  "absolute w-52 rounded-md border bg-panel shadow-sm",
                  selectedNodeId === node.id
                    ? "border-[var(--ring)] border-2 shadow-[var(--shadow-popover)]"
                    : "border-border",
                  fromNodeId === node.id && "ring-2 ring-ring/30"
                )}
                onPointerDown={(event) => nodePointerDown(event, node)}
                style={{
                  left: node.x,
                  top: node.y,
                  transition: dragging?.id === node.id ? "none" : "box-shadow 160ms ease"
                }}
              >
                <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 select-none">
                  <span className="cursor-grab active:cursor-grabbing text-muted-foreground">
                    <Icon name="grip-vertical" size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{node.title}</span>
                  <Pill>{role ?? "role"}</Pill>
                </div>
                <div className="space-y-1 px-2 py-2 text-[11px] text-muted-foreground select-none">
                  <div className="truncate">in: {node.input}</div>
                  <div className="truncate">out: {node.output}</div>
                  <div>role skills · {node.fileIds.length} files</div>
                </div>
                <div className="flex items-center gap-1 border-t border-border px-2 py-1.5 select-none">
                  <button
                    className="flex h-6 flex-1 items-center justify-center gap-1 rounded-sm border border-border bg-panel text-[11px] text-muted-foreground hover:bg-hover hover:text-foreground transition-colors"
                    onClick={(e) => { e.stopPropagation(); connectNode(node.id); }}
                    type="button"
                  >
                    <Icon name="git-branch" size={12} />
                    Connect
                  </button>
                  <Button aria-label="Delete step" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); deleteNode(node.id); }} size="icon" variant="ghost">
                    <Icon name="trash" size={12} />
                  </Button>
                </div>
                <div
                  data-port="true"
                  className="absolute -right-[10px] top-1/2 h-5 w-5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-border bg-panel-strong flex items-center justify-center hover:bg-ring hover:border-ring transition-colors z-10"
                  onPointerDown={(e) => edgePortPointerDown(e, node)}
                >
                  <Icon name="arrow-right" className="text-muted-foreground" size={10} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex h-9 shrink-0 items-center justify-center gap-2 border-t border-border bg-panel-raised px-3">
        <Button onClick={zoomOut} size="icon" variant="ghost" className="h-7 w-7">
          <span className="text-sm">−</span>
        </Button>
        <button
          onClick={resetView}
          className="min-w-[48px] rounded-md border border-border bg-background px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground hover:text-foreground transition-colors"
          type="button"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button onClick={zoomIn} size="icon" variant="ghost" className="h-7 w-7">
          <span className="text-sm">+</span>
        </Button>
      </div>
    </div>
  );
}

function NodeInspector({
  files,
  node,
  roles,
  skills,
  toggleNodeList,
  updateNode
}: {
  files: Array<{ id: string; title: string; folder?: string; kind: string }>;
  node: WorkstreamNode | null;
  roles: Array<{ id: string; name: string; status?: string }>;
  skills: SkillDefinition[];
  toggleNodeList: (nodeId: string, key: "skillIds" | "fileIds", value: string) => void;
  updateNode: (nodeId: string, patch: Partial<WorkstreamNode>) => void;
}) {
  if (!node) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-[11px] text-muted-foreground">
        <Icon name="git-branch" size={16} />
        <div>No step selected.</div>
        <div>Click a step on the canvas to edit it.</div>
      </div>
    );
  }

  const roleOptions = roles
    .filter((role) => role.status === "active" || role.id === node.roleId)
    .map((role) => ({
      label: role.status === "active" ? role.name : `${role.name} (disabled)`,
      value: role.id
    }));

  return (
    <div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
         <Icon name="git-branch" className="text-muted-foreground" size={14} />
        <span className="text-xs font-semibold text-foreground">Step Settings</span>
      </div>
      <div className="border-b border-border p-3">
        <Field label="Step title">
          <Input onChange={(event) => updateNode(node.id, { title: event.target.value })} value={node.title} />
        </Field>
      </div>
      <div className="grid gap-3 p-3">
        <Field label="Role">
          <NativeSelect
            ariaLabel="Step role"
            onChange={(value) => updateNode(node.id, { roleId: value })}
            options={roleOptions}
            value={node.roleId}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Input contract">
            <Input onChange={(event) => updateNode(node.id, { input: event.target.value })} value={node.input} />
          </Field>
          <Field label="Output contract">
            <Input onChange={(event) => updateNode(node.id, { output: event.target.value })} value={node.output} />
          </Field>
        </div>
        <Field label="Prompt override">
          <Textarea
            className="min-h-36 font-mono text-xs"
            onChange={(event) => updateNode(node.id, { prompt: event.target.value })}
            placeholder="Optional. Leave blank to use the role's current prompt."
            value={node.prompt}
          />
        </Field>
        <PickList
          activeIds={node.fileIds}
          items={files.map((file) => ({ id: file.id, title: file.title, subtitle: file.folder ?? file.kind }))}
          iconName="file-text"
          label="Files"
          searchPlaceholder="Search files"
          onToggle={(id) => toggleNodeList(node.id, "fileIds", id)}
        />
        <PickList
          activeIds={node.skillIds}
          items={skills
            .filter((skill) => skill.status === "active" || node.skillIds.includes(skill.id))
            .map((skill) => ({
              id: skill.id,
              title: skill.name,
              subtitle: skill.status === "active" ? skill.category : `${skill.category} - disabled`
            }))}
          iconName="sparkles"
          label="Skills"
          searchPlaceholder="Search skills"
          onToggle={(id) => toggleNodeList(node.id, "skillIds", id)}
        />
      </div>
    </div>
  );
}

function PickList({
  activeIds,
  iconName,
  items,
  label,
  searchPlaceholder,
  onToggle
}: {
  activeIds: string[];
  iconName: string;
  items: Array<{ id: string; title: string; subtitle: string }>;
  label: string;
  searchPlaceholder: string;
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? items.filter((item) =>
          [item.title, item.subtitle].some((value) => value.toLowerCase().includes(q))
        )
      : items;
    return [...filtered].sort((a, b) => {
      const aSelected = activeIds.includes(a.id);
      const bSelected = activeIds.includes(b.id);
      if (aSelected !== bSelected) return aSelected ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
  }, [activeIds, items, query]);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        <span>{label}</span>
        {activeIds.length > 0 ? <Pill className="ml-auto">{activeIds.length} selected</Pill> : null}
      </div>
      <div className="relative mb-1">
        <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={12} />
        <Input
          className="h-7 pl-7 text-xs"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          value={query}
        />
      </div>
      <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border border-border p-1">
        {filteredItems.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">
            No {label.toLowerCase()} match this search.
          </div>
        ) : filteredItems.map((item) => {
          const active = activeIds.includes(item.id);
          return (
            <button
              className={cn("flex items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-hover", active && "bg-selected")}
              key={item.id}
              onClick={() => onToggle(item.id)}
              type="button"
            >
              <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border", active ? "border-foreground-strong bg-foreground-strong text-background" : "border-border")}>
                 {active ? <Icon name="check" size={12} /> : null}
              </span>
              <Icon name={iconName} className="mt-0.5 shrink-0 text-muted-foreground" size={12} />
              <span className="min-w-0">
                <span className="block truncate text-[12px] text-foreground">{item.title}</span>
                <span className="line-clamp-1 text-[10px] text-muted-foreground">{item.subtitle}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
