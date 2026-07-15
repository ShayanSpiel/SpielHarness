import { cn } from "../index";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-panel-raised", className)}
      {...props}
    />
  );
}
