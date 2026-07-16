"use client";

import { cn } from "../index";
import { Skeleton } from "./skeleton";

export function SkeletonListItem({
  className,
  lines = 2,
  metadata = true,
}: {
  className?: string;
  lines?: 1 | 2;
  metadata?: boolean;
}) {
  return (
    <div className={cn("flex items-start gap-2 px-2 py-2", className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-2/5" />
          {metadata && (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <Skeleton className="h-4 w-10 rounded-sm" />
              <Skeleton className="h-4 w-7 rounded-sm" />
            </span>
          )}
        </div>
        {lines === 2 && <Skeleton className="mt-1.5 h-3 w-1/5" />}
      </div>
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-36 flex-col rounded-lg bg-panel-raised p-3",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2 pt-3">
        <Skeleton className="h-4 w-14 rounded-sm" />
        <Skeleton className="ml-auto h-6 w-16 rounded-md" />
      </div>
    </div>
  );
}

export function SkeletonFormField({
  label = true,
  className,
}: {
  label?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <Skeleton className="h-3 w-16" />}
      <Skeleton className="h-8 w-full rounded-md" />
    </div>
  );
}

export function SkeletonMemberRow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md bg-panel-raised p-3",
        className,
      )}
    >
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-5 w-14 rounded-sm" />
    </div>
  );
}

export function SkeletonBlock({
  className,
  height,
}: {
  className?: string;
  height?: string;
}) {
  return (
    <Skeleton
      className={cn("w-full", className)}
      style={height ? { height } : undefined}
    />
  );
}
