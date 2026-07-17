"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import { cn } from "../index";
import { Icon } from "./icons";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

const dialogLayouts = {
  default: "w-[calc(100vw-2rem)] max-w-md",
  command: "!top-[12vh] flex max-h-[min(72vh,calc(100vh-16vh))] w-[min(680px,92vw)] flex-col overflow-hidden p-0",
  context: "!top-[12vh] flex h-[min(70vh,calc(100vh-16vh))] max-h-[calc(100vh-16vh)] w-[min(960px,92vw)] flex-col overflow-hidden p-0",
  fullscreen: "!left-3 !top-3 flex !h-[calc(100vh-1.5rem)] !w-[calc(100vw-1.5rem)] !max-w-none !translate-x-0 !translate-y-0 flex-col overflow-hidden p-0",
} as const;

export const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "motion-overlay fixed inset-0 z-50 bg-[color:color-mix(in_oklab,var(--background)_70%,transparent)] backdrop-blur-sm",
        className
      )}
      {...props}
    />
  );
});

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    hideClose?: boolean;
    layout?: keyof typeof dialogLayouts;
  }
>(function DialogContent({ className, children, hideClose, layout = "default", ...props }, ref) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          layout === "default" ? "motion-dialog" : "motion-dialog-top",
          "fixed left-1/2 top-1/2 z-50 rounded-md border border-border bg-panel p-6 text-foreground shadow-popover focus:outline-none",
          dialogLayouts[layout],
          className
        )}
        {...props}
      >
        {children}
        {!hideClose ? (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-3 top-3 rounded-sm text-muted-foreground transition-colors duration-[var(--duration)] hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            <Icon name="x" size={16} />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

export function DialogHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-sm font-semibold text-foreground", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  children
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
    >
      {children}
    </div>
  );
}
