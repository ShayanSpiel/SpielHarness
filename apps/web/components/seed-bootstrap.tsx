"use client";

import { useEffect } from "react";

export function SeedBootstrap() {
  useEffect(() => {
    let cancelled = false;
    fetch("/api/harness/seed", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if ((data.seeded ?? 0) + (data.updated ?? 0) > 0) {
          console.log(`Synced harness seed files: ${data.seeded ?? 0} inserted, ${data.updated ?? 0} updated`);
          window.dispatchEvent(new CustomEvent("spielos:workspace-reload"));
        }
      })
      .catch((err) => console.warn("Seed check failed:", err));

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
