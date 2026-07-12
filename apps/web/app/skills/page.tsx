"use client";

import { useMemo, useState, useEffect, type Dispatch, type SetStateAction } from "react";
import { Button, EmptyState, Field, Input, PageHeader, Pill, ToggleRow, Tooltip, cn, toast } from "@spielos/design-system";
import { useDirty } from "@spielos/design-system/hooks/use-dirty";
import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import Image from "next/image";
import { AppShell } from "../../components/app-shell";
import { SidebarListPanel } from "../../components/sidebar-list-panel";
import { MentionTextarea } from "../../components/mention-textarea";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import type { SkillDefinition } from "../../lib/workspace-data";

type Connection = { id: string; name: string; kind: string; status: string; logo?: string | null; operations: Array<{ id: string; label?: string; effect?: string }> };
type ConnectionPreset = Connection & { description?: string };

function blankSkill(): Omit<SkillDefinition, "id" | "updatedAt"> {
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
    bindings: []
  };
}

export default function SkillsPage() {
  const store = useWorkspaceStore();
  const [selectedId, setSelectedId] = useState<string | null>(store.skills[0]?.id ?? null);
  const selected = store.skills.find((skill) => skill.id === selectedId) ?? null;
  const { draft, setDraft, dirty, reset, markSaved } = useDirty<SkillDefinition | Omit<SkillDefinition, "id" | "updatedAt">>(
    selected ?? blankSkill()
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const isNew = selectedId === null;

  useEffect(() => {
    fetch("/api/integrations", { cache: "no-store" }).then((res) => res.ok ? res.json() : { integrations: [], presets: [] }).then((data: { integrations?: Connection[]; presets?: Array<{ id: string; name: string; kind: string; logo?: string; description?: string; operations: Connection["operations"] }> }) => {
      const installed = data.integrations ?? [];
      const installedNames = new Set(installed.map((connection) => connection.name));
      const available: ConnectionPreset[] = (data.presets ?? []).filter((preset) => !installedNames.has(preset.name)).map((preset) => ({ ...preset, id: preset.kind === "builtin" ? `builtin:${preset.id}` : `preset:${preset.id}`, status: preset.kind === "builtin" ? "configured" : "needs_setup" }));
      setConnections([...installed, ...available]);
    }).catch(() => setConnections([]));
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
    store.setInspectorOpen(true);
    try {
      const created = await store.addSkill(blankSkill());
      setSelectedId(created.id);
      reset(created);
      store.setInspectorOpen(true);
      toast.success("Skill created");
    } catch {
      toast.error("Failed to create skill");
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

  function remove() {
    if (isNew) return;
    store.deleteSkill((draft as SkillDefinition).id);
    const next = store.skills.find((skill) => skill.id !== (draft as SkillDefinition).id);
    if (next) selectSkill(next);
    else {
      setSelectedId(null);
      reset(blankSkill());
    }
  }

  return (
    <AppShell inspector={<SkillInspector connections={connections} draft={draft} setDraft={setDraft} />}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name={ENTITY_ICONS.skill} size={14} />}
          title="Skills"
        />

        <div className="flex min-h-0 flex-1">
          <SidebarListPanel
            title="Skills"
            count={store.skills.length}
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
                {filtered.map((skill) => {
                  const active = skill.id === selectedId;
                  return (
                    <li key={skill.id}>
                      <button
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md border px-2 py-2 text-left transition-colors",
                          active
                            ? "border-border bg-selected text-foreground-strong"
                            : "border-transparent hover:bg-hover",
                          skill.status !== "active" && "opacity-55"
                        )}
                        onClick={() => selectSkill(skill)}
                        type="button"
                      >
                         <Icon name="reading-glass" className="mt-0.5 shrink-0 text-muted-foreground" size={14} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{skill.name}</span>

                            {skill.status !== "active" ? <Pill className="ml-auto">disabled</Pill> : null}
                          </span>
                          <span className="line-clamp-2 text-2xs text-muted-foreground">
                            {skill.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
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
                  {draft.status === "active" ? "enabled" : "disabled"}
                </Pill>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {!isNew ? (
                  <Tooltip content="Delete skill" side="bottom">
                    <Button aria-label="Delete skill" onClick={remove} size="icon" variant="ghost">
                       <Icon name="trash" size={14} />
                    </Button>
                  </Tooltip>
                ) : null}
                <Button disabled={!dirty || saving} onClick={save} size="md" variant={dirty ? "primary" : "outline"}>
                   {saving ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="save" size={14} />}
                   Save
                 </Button>
              </div>
            </div>

            <section className="flex min-h-0 flex-1">
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="grid shrink-0 gap-3 border-b border-border bg-panel-raised px-4 py-3 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
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
      </div>
    </AppShell>
  );
}

function SkillInspector({
  connections,
  draft,
  setDraft
}: {
  connections: Connection[];
  draft: SkillDefinition | Omit<SkillDefinition, "id" | "updatedAt">;
  setDraft: Dispatch<SetStateAction<SkillDefinition | Omit<SkillDefinition, "id" | "updatedAt">>>;
}) {
  return (
    <div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
         <Icon name="code" className="text-muted-foreground" size={14} />
         <span className="text-xs font-semibold text-foreground">Skill Settings</span>
      </div>

      <div className="grid gap-3 p-3">
        <div>
          <div className="mb-2 flex items-center gap-2"><Icon name="tool" size={14} /><span className="text-xs font-medium text-foreground">Tools</span><Pill className="ml-auto">{draft.bindings.filter((binding) => binding.enabled).length}</Pill></div>
          <div className="grid gap-1">
            {connections.flatMap((connection) => connection.operations.map((operation) => {
              const binding = draft.bindings.find((item) => item.connectionId === connection.id && item.operation === operation.id);
              const unavailable = connection.status !== "configured";
              return <button className={cn("flex items-start gap-2 rounded-md border px-2 py-2 text-left", binding?.enabled ? "border-border bg-selected" : "border-transparent bg-panel-raised hover:bg-hover", unavailable && "opacity-55")} disabled={unavailable} key={`${connection.id}:${operation.id}`} onClick={() => setDraft((current) => ({ ...current, bindings: binding ? current.bindings.filter((item) => !(item.connectionId === connection.id && item.operation === operation.id)) : [...current.bindings, { connectionId: connection.id, operation: operation.id, enabled: true, confirmation: operation.effect === "read" ? "never" : "on_write" }] }))} type="button">
                <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded border", binding?.enabled ? "border-foreground-strong bg-foreground-strong text-background" : "border-border bg-background")}>{binding?.enabled ? <Icon name="check" size={12} /> : connection.logo ? <Image alt="" height={16} src={connection.logo} width={16} /> : <Icon name={connection.kind === "builtin" ? "box" : "link"} size={12} />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{operation.label || operation.id}</span><span className="block truncate text-2xs text-muted-foreground">{connection.name} · {operation.effect || "read"}</span></span>
                {unavailable ? <Pill tone="warning">connect</Pill> : connection.kind === "builtin" ? <Pill tone="success">built-in</Pill> : null}
              </button>;
            }))}
            {connections.length === 0 ? <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground"><Icon name="link" className="mx-auto mb-1" size={16} />Add a connection in Settings to use external tools.</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
