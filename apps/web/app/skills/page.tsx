"use client";

import { useMemo, useState, useEffect, type Dispatch, type SetStateAction } from "react";
import { Button, ChoiceButton, ConfirmDialog, EmptyState, Field, Input, Inspector, InspectorBody, InspectorEmptyState, InspectorHeader, ListItem, PageHeader, Pill, Skeleton, ToggleRow, Tooltip, toast } from "@spielos/design-system";
import { useDirty } from "@spielos/design-system/hooks/use-dirty";
import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import Image from "next/image";
import { AppShell } from "../../components/app-shell";
import { SidebarListPanel } from "../../components/sidebar-list-panel";
import { MentionTextarea } from "../../components/mention-textarea";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import type { SkillDefinition } from "../../lib/workspace-data";

type Connection = { id: string; name: string; kind: string; status: string; logo?: string | null; operations: Array<{ id: string; label?: string; effect?: string }>; isLoading?: boolean };
type ConnectionPreset = Connection & { description?: string };

function blankSkill(): Omit<SkillDefinition, "id" | "orgId" | "updatedAt"> {
  return {
    name: "New skill",
    slug: "custom.skill",
    description: "Describe what this skill does, when an agent should call it, and what it returns.",
    kind: "llm_call",
    status: "draft",
    auth: "none",
    sideEffect: "none",
    inputSchema: '{ "input": "string" }',
    outputSchema: '{ "result": "string" }',
    implementation: "Define the skill behavior, provider, and safety constraints.",
    bindings: [],
    metadata: {}
  };
}

export default function SkillsPage() {
  const store = useWorkspaceStore();
  const [selectedId, setSelectedId] = useState<string | null>(store.skills[0]?.id ?? null);
  const selected = store.skills.find((skill) => skill.id === selectedId) ?? null;
  const { draft, setDraft, dirty, reset, markSaved } = useDirty<SkillDefinition | Omit<SkillDefinition, "id" | "orgId" | "updatedAt">>(
    selected ?? blankSkill()
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const isNew = selectedId === null;

  useEffect(() => {
    setConnectionsLoading(true);
    fetch("/api/integrations", { cache: "no-store" }).then((res) => res.ok ? res.json() : { integrations: [], presets: [] }).then((data: { integrations?: Array<Record<string, unknown>>; presets?: Array<{ id: string; name: string; kind: string; logo?: string; description?: string; operations: Connection["operations"] }> }) => {
      const raw = data.integrations ?? [];
      const installed: Connection[] = raw.map((i) => ({
        id: String(i.id ?? ""),
        name: String(i.name ?? ""),
        kind: String(i.kind ?? ""),
        status: String(i.status ?? ""),
        logo: ((i as Record<string, unknown>).config as Record<string, unknown> | null)?.logo as string | null ?? null,
        operations: (i.operations ?? []) as Connection["operations"],
      }));
      const installedNames = new Set(installed.map((connection) => connection.name));
      const available: ConnectionPreset[] = (data.presets ?? []).filter((preset) => !installedNames.has(preset.name)).map((preset) => ({ ...preset, id: preset.kind === "builtin" ? `builtin:${preset.id}` : `preset:${preset.id}`, status: preset.kind === "builtin" ? "configured" : "needs_setup" }));
      setConnections([...installed, ...available]);
    }).catch(() => setConnections([])).finally(() => setConnectionsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const found = store.skills.find((skill) => skill.id === selectedId);
    if (found) reset(found);
  }, [selectedId, store.skills, reset]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.skills;
    return store.skills.filter((skill) =>
      [skill.name, skill.description].some((value) =>
        value.toLowerCase().includes(q)
      )
    );
  }, [query, store.skills]);

  function selectSkill(skill: SkillDefinition) {
    setSelectedId(skill.id);
    reset(skill);
    store.setInspectorOpen(true);
  }

  async function createSkill() {
    if (creating) return;
    setCreating(true);
    store.setInspectorOpen(true);
    try {
      const created = await store.addSkill(blankSkill());
      setSelectedId(created.id);
      reset(created);
      store.setInspectorOpen(true);
      toast.success("Skill created");
    } catch {
      toast.error("Failed to create skill");
    } finally {
      setCreating(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      if (isNew) {
        const created = await store.addSkill(draft as Omit<SkillDefinition, "id" | "updatedAt">);
        setSelectedId(created.id);
        reset(created);
        toast.success("Skill created");
      } else {
        await store.updateSkill((draft as SkillDefinition).id, draft as Partial<SkillDefinition>);
        markSaved();
        toast.success("Skill saved");
      }
    } catch {
      toast.error("Failed to save skill");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (isNew) return;
    const id = (draft as SkillDefinition).id;
    try {
      await store.deleteSkill(id);
      const next = store.skills.find((skill) => skill.id !== id);
      if (next) selectSkill(next);
      else {
        setSelectedId(null);
        reset(blankSkill());
      }
      toast.success("Skill deleted");
    } catch {
      toast.error("Failed to delete skill");
    }
  }

  return (
    <AppShell inspector={<SkillInspector connections={connections} connectionsLoading={connectionsLoading} draft={draft} setDraft={setDraft} />}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name={ENTITY_ICONS.skill} size={14} />}
          title="Skills"
        />

        <div className="flex min-h-0 flex-1">
          <SidebarListPanel
            title="Skills"
            count={store.skills.length}
            newBusy={creating}
            onNew={createSkill}
            newTooltip="New skill"
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholder="Search skills"
          >
            {filtered.length === 0 ? (
              <EmptyState className="py-10" description="No skills match this search." title="No matches" />
            ) : (
              <ul className="grid gap-1">
                {filtered.map((skill) => <ListItem
                  active={skill.id === selectedId}
                  className={skill.status !== "active" ? "opacity-65" : undefined}
                  description={skill.description}
                  icon={ENTITY_ICONS.skill}
                  key={skill.id}
                  metadata={<Pill tone={skill.status === "active" ? "success" : "default"}>{skill.status === "active" ? "On" : "Off"}</Pill>}
                  onClick={() => selectSkill(skill)}
                  title={skill.name}
                />)}
              </ul>
            )}
          </SidebarListPanel>

          <main className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span>Skills</span>
                 <Icon name="chevron-right" size={12} />
                <span className="max-w-72 truncate text-foreground">{draft.name}</span>
                <Pill tone={draft.status === "active" ? "success" : "default"}>
                  {draft.status === "active" ? "Enabled" : "Disabled"}
                </Pill>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {!isNew ? (
                  <Tooltip content="Delete skill" side="bottom">
                    <Button aria-label="Delete skill" icon="trash" onClick={() => setConfirmDelete(true)} size="icon-xs" variant="ghost" />
                  </Tooltip>
                ) : null}
                <Button disabled={!dirty} icon="save" loading={saving} onClick={save} size="md" variant={dirty ? "primary" : "outline"}>
                   Save
                 </Button>
              </div>
            </div>

            <section className="flex min-h-0 flex-1">
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--editor-field-min)),1fr))] items-end gap-3 border-b border-border bg-panel-raised px-4 py-3">
                  <Field label="Name">
                    <Input
                      className="h-8 text-sm font-medium"
                      onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value, slug: event.target.value.toLowerCase().replace(/\s+/g, ".") }))}
                      value={draft.name}
                    />
                  </Field>
                  <Field label="Description">
                    <Input
                      className="h-8"
                      onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
                      value={draft.description}
                    />
                  </Field>
                  <Field label="Enabled">
                    <ToggleRow
                      checked={draft.status === "active"}
                      description={draft.status === "active" ? "Can run" : "Cannot run"}
                      onCheckedChange={(checked) =>
                        setDraft((d) => ({ ...d, status: checked ? "active" : "draft" }))
                      }
                    />
                  </Field>
                </div>

                <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel-raised px-4">
                   <Icon name="code" className="text-muted-foreground" size={14} />
                  <span className="text-xs font-medium text-foreground">Instructions</span>
                  <span className="ml-auto text-3xs text-muted-foreground select-none">
                    @ to mention
                  </span>
                </div>
                <MentionTextarea
                  className="min-h-0 flex-1"
                  mono
                  onChange={(v) => setDraft((d) => ({ ...d, implementation: v }))}
                  value={draft.implementation}
                />
              </div>
            </section>
          </main>
        </div>
        <ConfirmDialog
          confirmLabel="Delete skill"
          description={`Roles and workflows using ${draft.name} will lose access to it.`}
          onConfirm={async () => {
            setConfirmDelete(false);
            await remove();
          }}
          onOpenChange={setConfirmDelete}
          open={confirmDelete}
          title={`Delete ${draft.name}?`}
        />
      </div>
    </AppShell>
  );
}

function SkillInspector({
  connections,
  connectionsLoading,
  draft,
  setDraft
}: {
  connections: Connection[];
  connectionsLoading: boolean;
  draft: SkillDefinition | Omit<SkillDefinition, "id" | "orgId" | "updatedAt">;
  setDraft: Dispatch<SetStateAction<SkillDefinition | Omit<SkillDefinition, "id" | "orgId" | "updatedAt">>>;
}) {
  return (
    <Inspector>
      <InspectorHeader icon="code" title="Skill settings" />
      <InspectorBody className="p-3">
        <div>
          <div className="mb-2 flex items-center gap-2"><Icon name="tool" size={14} /><span className="text-xs font-medium text-foreground">Tools</span><Pill className="ml-auto">{draft.bindings.filter((binding) => binding.enabled).length}</Pill></div>
          <div className="grid gap-1">
            {connectionsLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md px-2 py-2">
                  <Skeleton className="h-6 w-6 shrink-0 rounded-md" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-4 w-14 shrink-0 rounded-sm" />
                </div>
              ))
            ) : connections.flatMap((connection) => (Array.isArray(connection.operations) ? connection.operations : []).map((operation) => {
              const binding = draft.bindings.find((item) => item.connectionId === connection.id && item.operation === operation.id);
              const unavailable = connection.status !== "configured";
              return <ChoiceButton
                className="px-2 py-2"
                description={`${connection.name} · ${operation.effect || "read"}`}
                disabled={unavailable}
                key={`${connection.id}:${operation.id}`}
                leading={
                  <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md bg-panel-raised text-muted-foreground">
                    {connection.logo ? <Image alt={`${connection.name} logo`} height={18} src={connection.logo} unoptimized width={18} /> : <Icon name={connection.kind === "builtin" ? "box" : "link"} size={14} />}
                  </span>
                }
                onClick={() => setDraft((current) => ({ ...current, bindings: binding ? current.bindings.filter((item) => !(item.connectionId === connection.id && item.operation === operation.id)) : [...current.bindings, { connectionId: connection.id, operation: operation.id, enabled: true, confirmation: operation.effect === "read" ? "never" : "on_write" }] }))}
                selected={Boolean(binding?.enabled)}
                selectionMode="multiple"
                trailing={unavailable ? <Pill tone="warning">Connect</Pill> : connection.kind === "builtin" ? <Pill tone="success">Built-in</Pill> : null}
              >
                {operation.label || operation.id}
              </ChoiceButton>;
            }))}
            {!connectionsLoading && connections.length === 0 ? <InspectorEmptyState description="Add a connection in Settings to make external tools available here." icon="link" title="No tools available" /> : null}
          </div>
        </div>
      </InspectorBody>
    </Inspector>
  );
}
