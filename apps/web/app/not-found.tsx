"use client";

import { Button, PageHeader } from "@spielos/design-system";
import { useRouter } from "next/navigation";

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <PageHeader icon={<span className="text-lg">?</span>} title="Page not found" />
      <p className="text-sm text-muted-foreground">The page you are looking for does not exist or has been moved.</p>
      <Button onClick={() => router.push("/")} variant="primary">
        Go home
      </Button>
    </div>
  );
}
