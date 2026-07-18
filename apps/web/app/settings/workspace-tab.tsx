"use client";

import { Icon } from "@spielos/design-system/components";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  ConfirmDialog,
  Field,
  Input,
  Pill,
  Skeleton,
  SkeletonFormField,
  SkeletonMemberRow,
  Spinner,
  Tooltip,
  toast
} from "@spielos/design-system";
import { useWorkspace, useWorkspaceStore } from "../../lib/use-workspace-store";

type Member = {
  profile_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
};

type Invitation = {
  id: string;
  org_id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
};

type OrgInfo = {
  org_id: string;
  org_name: string;
  org_slug: string;
  role: string;
};

export function WorkspaceTab() {
  const store = useWorkspaceStore();
  const { workspace } = useWorkspace();
  const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null);
  const [orgNameDraft, setOrgNameDraft] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(true);
  const [cancellingInvite, setCancellingInvite] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [syncingStarterFiles, setSyncingStarterFiles] = useState(false);
  const [starterSyncResult, setStarterSyncResult] = useState<string | null>(null);

  const isOwner = workspace?.role === "owner";

  const refetchTeam = useCallback(() => {
    if (!orgInfo) return;
    Promise.all([
      fetch(`/api/orgs/${orgInfo.org_id}/members`).then((r) => r.ok ? r.json() : { members: [] }),
      fetch(`/api/orgs/${orgInfo.org_id}/invitations`).then((r) => r.ok ? r.json() : { invitations: [] }),
    ])
      .then(([membersData, invitationsData]) => {
        setMembers((membersData as { members?: Member[] }).members ?? []);
        setInvitations((invitationsData as { invitations?: Invitation[] }).invitations ?? []);
      })
      .catch(() => {});
  }, [orgInfo]);

  useEffect(() => {
    if (!workspace) return;
    setOrgInfo({
      org_id: workspace.org_id,
      org_name: workspace.org_name,
      org_slug: "",
      role: workspace.role,
    });
    setOrgNameDraft(workspace.org_name);
    setMembersLoading(true);
    setInvitationsLoading(true);
    Promise.all([
      fetch(`/api/orgs/${workspace.org_id}/members`).then((r) => r.ok ? r.json() : { members: [] }),
      fetch(`/api/orgs/${workspace.org_id}/invitations`).then((r) => r.ok ? r.json() : { invitations: [] }),
    ])
      .then(([membersData, invitationsData]) => {
        setMembers((membersData as { members?: Member[] }).members ?? []);
        setInvitations((invitationsData as { invitations?: Invitation[] }).invitations ?? []);
      })
      .catch(() => {})
      .finally(() => {
        setMembersLoading(false);
        setInvitationsLoading(false);
      });
  }, [workspace]);

  const orgDirty = orgNameDraft !== orgInfo?.org_name;

  async function saveOrgSettings() {
    setSavingOrg(true);
    try {
      const slug = orgNameDraft.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
      const res = await fetch("/api/orgs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: orgNameDraft.trim(), slug }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Failed to save workspace settings");
        return;
      }
      toast.success("Workspace settings saved");
      document.cookie = `spielos.org-name=${encodeURIComponent(orgNameDraft.trim())}; path=/; max-age=${60 * 60 * 24 * 365}`;
    } catch {
      toast.error("Failed to save workspace settings");
    } finally {
      setSavingOrg(false);
    }
  }

  async function invite() {
    if (!inviteEmail.trim() || !orgInfo) return;
    setInviting(true);
    try {
      const res = await fetch(`/api/orgs/${orgInfo.org_id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: "admin" }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Failed to send invitation");
        return;
      }
      setInviteEmail("");
      toast.success("Invitation sent");
      refetchTeam();
    } catch {
      toast.error("Failed to send invitation");
    } finally {
      setInviting(false);
    }
  }

  async function cancelInvitation(invitationId: string) {
    if (!orgInfo) return;
    setCancellingInvite(invitationId);
    try {
      const res = await fetch(`/api/orgs/${orgInfo.org_id}/invitations?invitationId=${invitationId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to cancel invitation");
        return;
      }
      setInvitations((current) => current.filter((inv) => inv.id !== invitationId));
      toast.success("Invitation cancelled");
    } catch {
      toast.error("Failed to cancel invitation");
    } finally {
      setCancellingInvite(null);
    }
  }

  async function removeMember() {
    if (!selectedMember || !orgInfo) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/orgs/${orgInfo.org_id}/members?userId=${selectedMember.profile_id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to remove member");
        return;
      }
      setMembers((current) => current.filter((m) => m.profile_id !== selectedMember.profile_id));
      setConfirmRemove(false);
      setSelectedMember(null);
      toast.success("Member removed");
    } catch {
      toast.error("Failed to remove member");
    } finally {
      setRemoving(false);
    }
  }

  async function deleteWorkspace() {
    if (!orgInfo) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/orgs?id=${orgInfo.org_id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to delete workspace");
        return;
      }
      document.cookie = "spielos.org=; path=/; max-age=0";
      document.cookie = "spielos.org-name=; path=/; max-age=0";
      document.cookie = "spielos.org-role=; path=/; max-age=0";
      window.location.href = "/login";
    } catch {
      toast.error("Failed to delete workspace");
      setDeleting(false);
    }
  }

  async function syncStarterFiles() {
    setSyncingStarterFiles(true);
    setStarterSyncResult(null);
    try {
      const response = await fetch("/api/harness/seed", { method: "POST" });
      const payload = await response.json() as { error?: string; message?: string; seeded?: number; updated?: number; discovered?: number };
      if (!response.ok) throw new Error(payload.error ?? "Starter files could not be synchronized.");
      window.dispatchEvent(new Event("spielos:workspace-reload"));
      setStarterSyncResult(`${payload.message ?? `Inserted ${payload.seeded ?? 0}, updated ${payload.updated ?? 0}.`} ${payload.discovered ?? 0} seed resources discovered.`);
      toast.success("Starter files synchronized", { description: payload.message });
    } catch (cause) {
      toast.error("Starter files could not be synchronized", { description: cause instanceof Error ? cause.message : undefined });
    } finally {
      setSyncingStarterFiles(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-6 space-y-6">

        {/* Workspace Details */}
        <div className="rounded-md border border-border bg-panel p-5">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Workspace Details</h2>
          </div>
          <div className="grid gap-3">
            {!workspace ? (
              <SkeletonFormField />
            ) : (
              <>
                <Field label="Workspace name">
                  <Input
                    value={orgNameDraft}
                    onChange={(e) => setOrgNameDraft(e.target.value)}
                    disabled={!isOwner}
                  />
                </Field>
                {isOwner && (
                  <div className="flex justify-end">
                    <Button
                      disabled={!orgDirty || !orgNameDraft.trim()}
                      icon="save"
                      loading={savingOrg}
                      onClick={saveOrgSettings}
                      size="md"
                      variant={orgDirty ? "primary" : "outline"}
                    >
                      Save
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Team */}
        <div className="rounded-md border border-border bg-panel p-5">
          <div className="mb-4 flex items-center gap-2">
            <Icon name="users" size={14} />
            <h2 className="text-sm font-semibold text-foreground">Team</h2>
            <Pill>{members.length}</Pill>
          </div>
          <p className="text-xs text-muted-foreground">
            Manage team members and their access to this workspace.
          </p>

          {isOwner && (
            <div className="mt-4 grid gap-3 rounded-md bg-panel-raised p-3 md:grid-cols-[1fr_auto]">
              <Field label="Email">
                <Input
                  placeholder="colleague@example.com"
                  onChange={(e) => setInviteEmail(e.target.value)}
                  value={inviteEmail}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  disabled={!inviteEmail.trim()}
                  icon="plus"
                  loading={inviting}
                  onClick={invite}
                  size="md"
                  variant="primary"
                >
                  Add admin
                </Button>
              </div>
            </div>
          )}

          {membersLoading ? (
            <div className="mt-4 grid gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonMemberRow key={i} />
              ))}
            </div>
          ) : (
            <div className="mt-4 grid gap-2">
              {members.map((member) => (
                <div
                  className="flex items-center gap-3 rounded-md bg-panel-raised p-3"
                  key={member.profile_id}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-panel text-sm font-medium text-foreground-strong">
                    {(member.display_name || member.email)[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">
                      {member.display_name || member.email}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {member.email}
                    </div>
                  </div>
                  <Pill
                    tone={member.role === "owner" ? "primary" : "success"}
                  >
                    {member.role}
                  </Pill>
                  {isOwner && member.role !== "owner" ? (
                    <Tooltip content="Remove member" side="bottom">
                      <Button
                        aria-label={`Remove ${member.display_name || member.email}`}
                        icon="trash"
                        onClick={() => {
                          setSelectedMember(member);
                          setConfirmRemove(true);
                        }}
                        size="icon-xs"
                        variant="ghost"
                      />
                    </Tooltip>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {/* Pending Invitations */}
          {isOwner && (invitations.length > 0 || invitationsLoading) && (
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-xs font-semibold text-muted-foreground">Pending Invitations</h3>
                {invitationsLoading && <Spinner />}
              </div>
              <div className="grid gap-2">
                {invitationsLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-md bg-panel-raised p-3 opacity-60">
                      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <Skeleton className="h-3.5 w-1/3" />
                        <Skeleton className="h-3 w-1/4" />
                      </div>
                      <Skeleton className="h-6 w-6 shrink-0 rounded-md" />
                    </div>
                  ))
                ) : (
                invitations.map((inv) => (
                  <div
                    className="flex items-center gap-3 rounded-md bg-panel-raised p-3 opacity-60"
                    key={inv.id}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-panel text-sm font-medium text-muted-foreground">
                      {inv.email[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-muted-foreground">
                        {inv.email}
                      </div>
                      <div className="text-2xs text-muted-foreground">
                        Invited &middot; expires {new Date(inv.expires_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Tooltip content="Cancel invitation" side="bottom">
                      <Button
                        aria-label={`Cancel invitation for ${inv.email}`}
                        icon="trash"
                        loading={cancellingInvite === inv.id}
                        onClick={() => cancelInvitation(inv.id)}
                        size="icon-xs"
                        variant="ghost"
                      />
                    </Tooltip>
                  </div>
                ))
                )}
              </div>
            </div>
          )}
        </div>

        {isOwner ? (
          <div className="rounded-md border border-border bg-panel p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-panel-raised text-info"><Icon name="refresh" size={14} /></span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-foreground">Starter library</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Synchronize the editable file-backed roles, skills, workflows, evals, prompts, and templates shipped with this workspace. Your generated Outputs and Google Drive files are not modified.</p>
                {starterSyncResult ? <p className="mt-2 text-2xs text-success">{starterSyncResult}</p> : null}
              </div>
              <Button loading={syncingStarterFiles} onClick={() => void syncStarterFiles()} size="md" variant="outline">Sync files</Button>
            </div>
          </div>
        ) : null}

        {/* Danger Zone */}
        {isOwner && (
          <div className="rounded-md border border-border bg-panel p-5">
            <div className="mb-4 flex items-center gap-2">
              <Icon name="alert" size={14} className="text-destructive" />
              <h2 className="text-sm font-semibold text-destructive">Danger Zone</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Irreversible actions for this workspace. Proceed with caution.
            </p>
            <div className="mt-4 flex gap-3">
              <Button
                onClick={() => setResetOpen(true)}
                size="md"
                variant="danger"
              >
                <Icon name="wand" size={14} />
                Reset workspace
              </Button>
              <Button
                onClick={() => setDeleteOpen(true)}
                size="md"
                variant="danger"
              >
                <Icon name="trash" size={14} />
                Delete workspace
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        confirmLabel="Reset workspace"
        description="This permanently clears locally stored chats, artifacts, roles, models, and folders. This action cannot be undone."
        onConfirm={() => {
          store.resetWorkspace();
          setResetOpen(false);
          toast.success("Workspace reset");
        }}
        onOpenChange={setResetOpen}
        open={resetOpen}
        title="Reset the workspace?"
      />

      <ConfirmDialog
        busy={removing}
        confirmLabel="Remove member"
        description={`${selectedMember?.display_name || selectedMember?.email} will lose access to this workspace.`}
        onConfirm={removeMember}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmRemove(false);
            setSelectedMember(null);
          }
        }}
        open={confirmRemove}
        title={`Remove ${selectedMember?.display_name || "member"}?`}
      />

      <ConfirmDialog
        busy={deleting}
        confirmLabel="Delete workspace"
        description="This workspace and all its data will be permanently deleted. You will be signed out."
        onConfirm={deleteWorkspace}
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
        title="Delete this workspace?"
      />
    </div>
  );
}
