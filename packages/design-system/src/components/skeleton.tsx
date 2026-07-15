"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../index";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  function Skeleton({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("skeleton", className)}
        {...props}
      />
    );
  }
);
