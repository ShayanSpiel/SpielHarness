import { memo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps, EdgeLabelRenderer } from "@xyflow/react";
import { Icon } from "@spielos/design-system/components";

type WorkflowEdgeData = {
  onDelete?: (edgeId: string) => void;
};

function WorkflowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? "var(--ring)" : "var(--foreground-muted)",
          strokeWidth: selected ? 2.5 : 1.5,
          transition: "stroke 120ms ease, stroke-width 120ms ease",
        }}
        className="hover:brightness-110"
      />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: "pointer", pointerEvents: "stroke" }}
      />
      {selected && (data as WorkflowEdgeData | undefined)?.onDelete && (
        <EdgeLabelRenderer>
          <button
            className="absolute flex h-5 w-5 items-center justify-center rounded-sm border border-border bg-panel text-muted-foreground hover:bg-hover hover:text-foreground transition-colors"
            onClick={() => (data as WorkflowEdgeData)?.onDelete?.(id)}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            type="button"
          >
            <Icon name="trash" size={10} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const WorkflowEdge = memo(WorkflowEdgeComponent);
