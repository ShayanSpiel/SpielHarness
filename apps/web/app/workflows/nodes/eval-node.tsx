import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Icon } from "@spielos/design-system/components";
import { Button, Pill, cn } from "@spielos/design-system";
import type { WorkflowNodeData } from "./role-node";
import { NODE_DIMENSIONS } from "../workflow-canvas-config";

function EvalNodeComponent({ data }: NodeProps<Node<WorkflowNodeData>>) {
  const { node, role, isConnecting, selected, hasIncoming, hasOutgoing, onConnect, onDelete } = data;

  return (
    <div
      className={cn(
        "w-52 rounded-md border bg-panel shadow-panel",
        selected
          ? "border-[var(--ring)] border-2 shadow-[var(--shadow-popover)]"
          : "border-border",
        isConnecting && "ring-2 ring-[var(--ring)]/30"
      )}
      style={{ width: NODE_DIMENSIONS.width }}
    >
      <Handle type="target" position={Position.Left} className="!h-5 !w-5 !border-2 !border-border !bg-panel-strong !flex !items-center !justify-center">
        {hasIncoming ? <Icon name="chevron-right" size={10} /> : <Icon name="play" size={10} />}
      </Handle>
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 select-none">
        <span className="text-muted-foreground">
          <Icon name="bar-chart" size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{node.title}</span>
        <Pill>QA</Pill>
      </div>
      <div className="space-y-1 px-2 py-2 text-2xs text-muted-foreground select-none">
        <div className="truncate">in: {node.inputContract}</div>
        <div className="truncate">out: {node.outputContract}</div>
        <div>
          {role ?? "Eval"} - {node.fileIds.length} files
        </div>
      </div>
      <div className="flex items-center gap-1 border-t border-border px-2 py-1.5 select-none">
        <button
          className="flex h-6 flex-1 items-center justify-center gap-1 rounded-sm border border-border bg-panel text-2xs text-muted-foreground hover:bg-hover hover:text-foreground transition-colors"
          onClick={(e) => { e.stopPropagation(); onConnect(node.id); }}
          type="button"
        >
          <Icon name="workflow-alt" size={12} />
          Connect
        </button>
        <Button aria-label="Delete step" className="h-6 w-6" icon="trash" onClick={(e) => { e.stopPropagation(); onDelete(node.id); }} size="icon" variant="ghost" />
      </div>
      <Handle type="source" position={Position.Right} className="!h-5 !w-5 !border-2 !border-border !bg-panel-strong !flex !items-center !justify-center">
        {hasOutgoing ? <Icon name="chevron-right" size={10} /> : null}
      </Handle>
    </div>
  );
}

export const EvalNode = memo(EvalNodeComponent);
