"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ActionRow,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Notice,
  Pill,
  StatusIcon
} from "@spielos/design-system";
import { Icon } from "@spielos/design-system/components";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import { fetchJsonWithRetry } from "../../lib/fetch-json";

type RunRow = {
  id: string;
  status: string;
  prompt: string;
  created_at: string;
  completed_at: string | null;
  chat_id: string | null;
  type: string;
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function statusTone(status: string): "default" | "success" | "warning" | "destructive" {
  if (status === "completed") return "success";
  if (status === "failed") return "destructive";
  if (status === "cancelled") return "default";
  if (status === "waiting_human") return "warning";
  return "default";
}

export function RunsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const store = useWorkspaceStore();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setQuery("");
    fetchJsonWithRetry<{ runs: RunRow[] }>("/api/runs", { cache: "no-store" })
      .then((data: { runs: RunRow[] }) => setRuns(data.runs ?? []))
      .catch(() => {
        setRuns([]);
        setError("Run history could not be loaded. Close this dialog and try again.");
      })
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter(
      (r) =>
        r.prompt.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
    );
  }, [runs, query]);

  function selectRun(r: RunRow) {
    onOpenChange(false);
    if (r.chat_id && r.chat_id !== store.activeChatId) {
      store.setActiveChat(r.chat_id);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Recent runs</DialogTitle>
          <DialogDescription>Resume a previous run or start a new one.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by prompt, type, or status…"
          value={query}
        />
        <div className="-mx-1 max-h-96 overflow-x-hidden overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-2xs text-muted-foreground">
              <StatusIcon busy icon="activity" size={12} />
              Loading run history
            </div>
          ) : error ? (
            <Notice className="m-1" tone="destructive" title="Could not load runs">{error}</Notice>
          ) : filtered.length === 0 ? (
            <EmptyState className="py-10" description={query ? "No runs match this search." : "No runs yet."} title={query ? "No matches" : "Empty"} />
          ) : (
            <ul className="grid min-w-0 gap-0.5 p-1">
              {filtered.map((r) => (
                <li className="min-w-0" key={r.id}>
                  <ActionRow
                    description={`${r.type} · ${timeAgo(r.created_at)}`}
                    leading={<Icon name="play" size={12} />}
                    onClick={() => selectRun(r)}
                    title={r.prompt.slice(0, 80) || "Run"}
                    trailing={<Pill tone={statusTone(r.status)} className="text-3xs capitalize">{r.status}</Pill>}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
