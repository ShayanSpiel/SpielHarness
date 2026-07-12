"use client";

import { useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnConnect,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { RoleNode, type WorkflowNodeData } from "./nodes/role-node";
import { EvalNode } from "./nodes/eval-node";
import { WorkflowEdge } from "./edges/workflow-edge";
import { CANVAS_CONFIG, NODE_DIMENSIONS } from "./workflow-canvas-config";
import type { WorkstreamDefinition, WorkstreamNode } from "../../lib/workspace-data";
import { EmptyState } from "@spielos/design-system";

const nodeTypes = {
  role: RoleNode,
  eval: EvalNode,
};

const edgeTypes = {
  "workflow-edge": WorkflowEdge,
};

function buildNodes(
  draftNodes: WorkstreamNode[],
  rolesById: Map<string, string>,
  evalsById: Map<string, string>,
  fromNodeId: string | null,
  connectNode: (id: string) => void,
  deleteNode: (id: string) => void,
  updateNode: (id: string, patch: Partial<WorkstreamNode>) => void,
): Node<WorkflowNodeData>[] {
  return draftNodes.map((n) => ({
    id: n.id,
    type: n.nodeType === "eval" ? "eval" : "role",
    position: { x: n.x, y: n.y },
    data: {
      node: n,
      role:
        n.nodeType === "eval"
          ? evalsById.get(n.skillIds[0] ?? "")
          : rolesById.get(n.roleId),
      isConnecting: fromNodeId === n.id,
      selected: false,
      onConnect: connectNode,
      onDelete: deleteNode,
      updateNode,
    },
    width: NODE_DIMENSIONS.width,
  }));
}

function buildEdges(
  draftEdges: WorkstreamDefinition["edges"],
  removeEdge: (id: string) => void,
): Edge[] {
  return draftEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "workflow-edge",
    data: { onDelete: removeEdge },
  }));
}

function FlowContent({
  draft,
  rolesById,
  evalsById,
  fromNodeId,
  updateNode,
  addEdge,
  deleteNode,
  removeEdge,
  connectNode,
  addStep,
  onNodeSelect,
}: {
  draft: WorkstreamDefinition | Omit<WorkstreamDefinition, "id" | "updatedAt">;
  rolesById: Map<string, string>;
  evalsById: Map<string, string>;
  fromNodeId: string | null;
  updateNode: (nodeId: string, patch: Partial<WorkstreamNode>) => void;
  addEdge: (sourceId: string, targetId: string) => void;
  deleteNode: (nodeId: string) => void;
  removeEdge: (edgeId: string) => void;
  connectNode: (targetId: string) => void;
  addStep: (type: "role" | "eval", id: string, x?: number, y?: number) => void;
  onNodeSelect: (nodeId: string | null) => void;
}) {
  const instance = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WorkflowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const prevNodeCount = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    setNodes(buildNodes(draft.nodes, rolesById, evalsById, fromNodeId, connectNode, deleteNode, updateNode));
    setEdges(buildEdges(draft.edges, removeEdge));
    if (draft.nodes.length > 0) {
      setTimeout(() => instance.fitView({ padding: CANVAS_CONFIG.fitViewPadding, duration: 200 }), 80);
    }
    mounted.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mounted.current) return;
    const nodeCount = draft.nodes.length;
    if (nodeCount !== prevNodeCount.current) {
      prevNodeCount.current = nodeCount;
      setNodes(buildNodes(draft.nodes, rolesById, evalsById, fromNodeId, connectNode, deleteNode, updateNode));
      setEdges(buildEdges(draft.edges, removeEdge));
      if (nodeCount > 0) {
        setTimeout(() => instance.fitView({ padding: CANVAS_CONFIG.fitViewPadding, duration: 200 }), 50);
      }
    }
  }, [draft.nodes.length, draft.edges.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodeDragStop: OnNodeDrag<Node<WorkflowNodeData>> = useCallback(
    (_, node: Node<WorkflowNodeData>) => {
      updateNode(node.id, {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      });
    },
    [updateNode],
  );

  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (connection.source && connection.target) {
        addEdge(connection.source, connection.target);
      }
    },
    [addEdge],
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const rawStep = event.dataTransfer.getData("application/spielos-step");
      const fallback = event.dataTransfer.getData("text/plain");
      let step: { type: "role" | "eval"; id: string } | null = null;
      if (rawStep) {
        try {
          const parsed = JSON.parse(rawStep) as { type?: string; id?: string };
          if ((parsed.type === "role" || parsed.type === "eval") && parsed.id) {
            step = { type: parsed.type, id: parsed.id };
          }
        } catch {
          step = null;
        }
      }
      if (!step && fallback) {
        const [type, id] = fallback.includes(":") ? fallback.split(":") : ["role", fallback];
        if ((type === "role" || type === "eval") && id) step = { type, id };
      }
      if (!step) return;
      const position = instance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addStep(
        step.type,
        step.id,
        Math.round(position.x - NODE_DIMENSIONS.width / 2),
        Math.round(position.y - 22),
      );
    },
    [instance, addStep],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={(_, node) => onNodeSelect(node.id)}
      onPaneClick={() => onNodeSelect(null)}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      minZoom={CANVAS_CONFIG.minZoom}
      maxZoom={CANVAS_CONFIG.maxZoom}
      snapToGrid={CANVAS_CONFIG.snapToGrid}
      snapGrid={CANVAS_CONFIG.snapGrid}
      defaultEdgeOptions={CANVAS_CONFIG.defaultEdgeOptions}
      connectionLineStyle={CANVAS_CONFIG.connectionLineStyle}
      fitView={false}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      deleteKeyCode="Backspace"
      multiSelectionKeyCode="Shift"
      panOnDrag={[0, 1, 2]}
      selectNodesOnDrag={false}
      className="bg-background"
    >
      <Background variant={BackgroundVariant.Lines} gap={32} size={0.5} color="var(--border)" style={{ opacity: 0.3 }} />
      <Controls showInteractive={false} />
      <MiniMap
        nodeStrokeColor="var(--border)"
        bgColor="var(--background)"
        maskColor="var(--backdrop)"
        pannable
        zoomable
      />
    </ReactFlow>
  );
}

export function GraphCanvas({
  setSelectedNodeId,
  ...props
}: {
  draft: WorkstreamDefinition | Omit<WorkstreamDefinition, "id" | "updatedAt">;
  rolesById: Map<string, string>;
  evalsById: Map<string, string>;
  fromNodeId: string | null;
  updateNode: (nodeId: string, patch: Partial<WorkstreamNode>) => void;
  addEdge: (sourceId: string, targetId: string) => void;
  deleteNode: (nodeId: string) => void;
  removeEdge: (edgeId: string) => void;
  connectNode: (targetId: string) => void;
  setSelectedNodeId: (id: string) => void;
  setFromNodeId: (id: string | null) => void;
  addStep: (type: "role" | "eval", id: string, x?: number, y?: number) => void;
}) {
  return (
    <div className="relative min-h-0 flex-1">
      {props.draft.nodes.length === 0 ? (
        <EmptyState
          className="absolute inset-0 z-10"
          description="Add roles or QA eval steps from the toolbar, or drag a step onto the canvas."
          title="No steps yet"
        />
      ) : null}
      <ReactFlowProvider>
        <FlowContent
          {...props}
          onNodeSelect={(id) => setSelectedNodeId(id ?? "")}
        />
      </ReactFlowProvider>
    </div>
  );
}
