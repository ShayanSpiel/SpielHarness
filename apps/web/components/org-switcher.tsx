"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@spielos/design-system/components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@spielos/design-system/components/dropdown-menu";
import { cn } from "@spielos/design-system";
import { useWorkspace } from "../lib/workspace-context";

type Org = {
  org_id: string;
  org_name: string;
  org_slug: string;
  role: string;
};

function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function OrgBadge({ name, className }: { name: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-sm",
        "text-3xs font-semibold",
        className
      )}
    >
      {orgInitials(name)}
    </div>
  );
}

export function OrgSwitcher() {
  const { workspace, switchWorkspace } = useWorkspace();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [switching, setSwitching] = useState(false);
  const [creating, setCreating] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetch("/api/orgs", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { orgs: [] }))
      .then((data: { orgs?: Org[] }) => setOrgs(data.orgs ?? []))
      .catch(() => {});
  }, []);

  async function handleSwitch(orgId: string) {
    if (orgId === workspace?.org_id) return;
    setSwitching(true);
    try {
      await switchWorkspace(orgId);
    } finally {
      setSwitching(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New workspace" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.org) {
          await switchWorkspace(data.org.id);
          window.location.href = "/settings?tab=workspace";
        }
      }
    } finally {
      setCreating(false);
    }
  }

  const displayName = workspace?.org_name ?? "Workspace";
  const loading = switching || creating;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-[var(--duration)]",
            "hover:bg-hover hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
            loading && "opacity-60 pointer-events-none"
          )}
          disabled={loading}
          type="button"
          aria-label={`Workspace: ${displayName}`}
        >
          <OrgBadge name={displayName} className="bg-primary-soft text-primary" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        side="right"
        sideOffset={8}
      >
        <DropdownMenuLabel>
          <span className="text-xs text-muted-foreground">
            {workspace?.org_name ?? "Workspace"}
          </span>
        </DropdownMenuLabel>
        {orgs.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            {orgs.map((org) => (
              <DropdownMenuItem
                key={org.org_id}
                onSelect={() => handleSwitch(org.org_id)}
              >
                <div className="flex items-center gap-2">
                  <OrgBadge
                    name={org.org_name}
                    className="h-4 w-4 bg-primary-soft text-3xs text-primary"
                  />
                  <span className="text-sm">{org.org_name}</span>
                  {org.org_id === workspace?.org_id ? (
                    <Icon
                      name="check"
                      size={12}
                      className="ml-auto text-primary"
                    />
                  ) : null}
                </div>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {orgs.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          onSelect={handleCreate}
          disabled={creating}
        >
          <div className="flex items-center gap-2">
            <Icon name="plus" size={14} className="text-muted-foreground" />
            <span className="text-sm">
              {creating ? "Creating..." : "New workspace"}
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => (window.location.href = "/settings?tab=workspace")}
        >
          <div className="flex items-center gap-2">
            <Icon name="settings" size={14} className="text-muted-foreground" />
            <span className="text-sm">Workspace settings</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
