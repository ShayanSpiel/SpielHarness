"use client";

import { Toaster } from "sonner";
import { Icon } from "./icons";

export function AppToaster() {
  return (
    <Toaster
      closeButton
      icons={{
        success: <Icon name="check-circle" className="text-success" size={16} />,
        error: <Icon name="alert-circle" className="text-destructive" size={16} />,
        warning: <Icon name="alert-triangle" className="text-warning" size={16} />,
        info: <Icon name="info" className="text-info" size={16} />,
        loading: <Icon name="loader" className="animate-spin text-info" size={16} />
      }}
      position="bottom-right"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm text-foreground shadow-popover",
          default: "border-border bg-panel-strong",
          success: "border-success/40 bg-success-soft",
          error: "border-destructive/45 bg-destructive-soft",
          warning: "border-warning/40 bg-warning-soft",
          info: "border-info/40 bg-info-soft",
          loading: "border-info/30 bg-panel-strong",
          content: "min-w-0 flex-1",
          title: "font-medium leading-5",
          description: "mt-0.5 text-xs leading-4 text-muted-foreground",
          icon: "mt-0.5 shrink-0",
          closeButton: "rounded-sm !text-muted-foreground !border-border transition-colors hover:!text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
          actionButton: "rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground",
          cancelButton: "rounded-md bg-panel px-2 py-1 text-xs font-medium text-foreground"
        }
      }}
    />
  );
}
