"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@spielos/design-system/components/avatar";
import { Icon } from "@spielos/design-system/components";
import { Popover, PopoverContent, PopoverTrigger, cn } from "@spielos/design-system";
import { Skeleton } from "@spielos/design-system";
import { useWorkspace } from "../lib/workspace-context";
import { signOut, useSession } from "../lib/auth-client";
import { useCallback, useState } from "react";

type Org = {
  org_id: string;
  org_name: string;
  org_slug: string;
  role: string;
};

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const { workspace, switchWorkspace } = useWorkspace();
  const { data: sessionData, isPending: sessionLoading } = useSession();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [switching, setSwitching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);

  const user = sessionData?.user ?? null;

  const fetchOrgs = useCallback(async () => {
    try {
      const res = await fetch("/api/orgs", { cache: "no-store" });
      const data: { orgs?: Org[] } = res.ok ? await res.json() : { orgs: [] };
      setOrgs(data.orgs ?? []);
    } catch {
      setOrgs([]);
    }
  }, []);

  async function handleSwitch(orgId: string) {
    if (orgId === workspace?.org_id) return;
    setSwitching(true);
    try {
      await switchWorkspace(orgId);
    } finally {
      setSwitching(false);
      setOpen(false);
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

  async function handleSignOut() {
    await signOut();
    window.location.href = "/login";
  }

  const loading = switching || creating;

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen && orgs.length === 0) fetchOrgs();
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-[var(--duration)]",
            "hover:bg-hover hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
            loading && "opacity-60 pointer-events-none"
          )}
          disabled={loading}
          type="button"
          aria-label={`Profile: ${user?.name ?? "User"}`}
        >
          {sessionLoading ? (
            <Skeleton className="h-6 w-6 rounded-full" />
          ) : (
            <Avatar className="h-6 w-6">
              <AvatarImage src={user?.image ?? undefined} alt={user?.name ?? ""} />
              <AvatarFallback>{user?.name ? initials(user.name) : "U"}</AvatarFallback>
            </Avatar>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-1.5"
        side="right"
        sideOffset={8}
      >
        {/* User info */}
        <div className="flex items-center gap-3 px-2 py-2">
          {sessionLoading ? (
            <>
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2.5 w-32" />
              </div>
            </>
          ) : user ? (
            <>
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarImage src={user.image ?? undefined} alt={user.name ?? ""} />
                <AvatarFallback className="text-sm">{user.name ? initials(user.name) : "U"}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {user.name ?? "User"}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {user.email}
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 px-1 py-1 text-sm text-muted-foreground">
              <Icon name="user" size={14} />
              <span>Not signed in</span>
            </div>
          )}
        </div>

        {/* Gmail shortcut */}
        {user?.email ? (
          <a
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(user.email)}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-panel text-muted-foreground">
              <Icon name="mail" size={11} />
            </span>
            <span>Open Gmail</span>
            <Icon className="ms-auto text-muted-foreground" name="external-link" size={10} />
          </a>
        ) : null}

        <div className="my-1.5 h-px bg-border" />

        {/* Workspace section */}
        <div className="flex items-center gap-2 px-2 py-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-panel text-muted-foreground">
            <Icon name="users" size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-foreground">Workspaces</div>
            <div className="text-3xs text-muted-foreground">Switch or create a workspace.</div>
          </div>
          <span className="text-3xs tabular-nums text-muted-foreground">{orgs.length}</span>
        </div>

        <div className="mt-1 max-h-48 overflow-y-auto">
          {orgs.length === 0 ? (
            Array.from({ length: 2 }).map((_, i) => (
              <div className="flex items-center gap-2 px-2 py-2" key={i}>
                <Skeleton className="h-5 w-5 shrink-0 rounded-sm" />
                <Skeleton className="h-3 flex-1" />
              </div>
            ))
          ) : (
            orgs.map((org) => {
              const active = org.org_id === workspace?.org_id;
              return (
                <button
                  className={cn(
                    "group grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 rounded-md px-2 py-2 text-start transition-colors duration-[var(--duration)]",
                    active
                      ? "bg-selected text-foreground"
                      : "text-foreground hover:bg-hover"
                  )}
                  key={org.org_id}
                  onClick={() => handleSwitch(org.org_id)}
                  aria-checked={active}
                  role="menuitemradio"
                  type="button"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-primary-soft text-3xs font-semibold text-primary">
                    {initials(org.org_name)}
                  </span>
                  <span className="min-w-0 truncate text-xs font-medium">{org.org_name}</span>
                  <Icon className={cn("shrink-0 text-info transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-30")} name="check" size={12} />
                </button>
              );
            })
          )}
        </div>

        <button
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-hover"
          disabled={creating}
          onClick={handleCreate}
          type="button"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-panel text-muted-foreground">
            <Icon name="plus" size={11} />
          </span>
          <span className="text-xs">{creating ? "Creating..." : "New workspace"}</span>
        </button>

        <div className="my-1.5 h-px bg-border" />

        {/* Sign out */}
        {user ? (
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-hover"
            onClick={handleSignOut}
            type="button"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-panel text-muted-foreground">
              <Icon name="arrow-right" size={11} />
            </span>
            <span>Sign out</span>
          </button>
        ) : (
          <a
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-hover"
            href="/login"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-panel text-muted-foreground">
              <Icon name="user" size={11} />
            </span>
            <span>Sign in</span>
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}
