import { MarkerType, type Edge, type ConnectionLineType } from "@xyflow/react";

export const CANVAS_CONFIG = {
  minZoom: 0.15,
  maxZoom: 2,
  snapToGrid: true,
  snapGrid: [32, 32] as [number, number],
  fitViewPadding: 0.15,
  connectionLineStyle: { stroke: "var(--ring)", strokeWidth: 2 },
  connectionLineType: "default" as ConnectionLineType,
  defaultEdgeOptions: {
    type: "workflow-edge",
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--foreground-muted)", width: 14, height: 14 },
  } satisfies Partial<Edge>,
  nodeGap: 80,
};

export const NODE_DIMENSIONS = {
  width: 208,
  height: 134,
} as const;
