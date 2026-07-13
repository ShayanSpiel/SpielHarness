"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { StatusIcon, type StatusTone } from "./status-icon";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: Extract<StatusTone, "warning" | "destructive">;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "destructive",
  busy = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm p-0" hideClose={busy}>
        <div className="flex items-start gap-3 px-5 pb-4 pt-5">
          <StatusIcon
            className={tone === "destructive"
              ? "mt-0.5 h-7 w-7 rounded-md bg-destructive-soft"
              : "mt-0.5 h-7 w-7 rounded-md bg-warning-soft"}
            icon={tone === "destructive" ? "alert-circle" : "alert-triangle"}
            size={14}
            tone={tone}
          />
          <DialogHeader className="min-w-0 flex-1">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {description}
            </DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter className="border-t border-border bg-panel-raised px-5 py-3">
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            size="sm"
            variant="outline"
          >
            {cancelLabel}
          </Button>
          <Button
            loading={busy}
            onClick={() => void onConfirm()}
            size="sm"
            variant={tone === "destructive" ? "danger" : "primary"}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
