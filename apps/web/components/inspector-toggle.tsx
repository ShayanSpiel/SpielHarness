"use client";

import { Button, Tooltip } from "@spielos/design-system";
import { useUiStore } from "../lib/use-ui-store";

export function InspectorToggle({ label }: { label: string }) {
  const ui = useUiStore();
  return (
    <Tooltip content={label} side="bottom">
      <Button
        aria-label={label}
        icon={ui.inspectorOpen ? "panel-right-close" : "panel-right-open"}
        onClick={ui.toggleInspector}
        size="icon"
        variant="ghost"
      />
    </Tooltip>
  );
}
