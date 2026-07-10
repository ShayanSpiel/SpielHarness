"use client";

import { Icon } from "./icons";
import { Button, Tooltip } from "@spielos/design-system";
import { useWorkspaceStore } from "../lib/use-workspace-store";

export function InspectorToggle({ label }: { label?: string }) {
  const store = useWorkspaceStore();

  return (
    <Tooltip content={store.inspectorOpen ? "Close panel" : (label ?? "Open panel")} side="bottom">
      <Button
        aria-label={store.inspectorOpen ? "Close panel" : (label ?? "Open panel")}
        onClick={() => store.toggleInspector()}
        size="icon"
        variant="ghost"
      >
        <Icon name={store.inspectorOpen ? "panel-right-close" : "panel-right-open"} size={14} />
      </Button>
    </Tooltip>
  );
}
