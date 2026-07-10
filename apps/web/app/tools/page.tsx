"use client";

import { useMemo, useState, useEffect, type Dispatch, type SetStateAction } from "react";
import { Button, EmptyState, Field, Input, NativeSelect, PageHeader, Pill, SearchInput, Textarea, Tooltip, cn, toast } from "@spielos/design-system";
import { useDirty } from "@spielos/design-system/hooks/use-dirty";
import { Icon } from "../../components/icons";
import { InspectorToggle } from "../../components/inspector-toggle";
import { AppShell } from "../../components/app-shell";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import type { SkillDefinition } from "../../lib/workspace-data";

function blankSkill(): Omit<SkillDefinition, "id" | "updatedAt"> {
  return {
    name: "New skill",
    slug: "custom.skill",
    description: "Describe what this skill does, when an agent should call it, and what it returns.",
    category: "custom",
    status: "draft",
    auth: "none",
    sideEffect: "none",
    inputSchema: '{ "input": "string" }',
    outputSchema: '{ "result": "string" }',
    implementation: "Define the skill behavior, provider, and safety constraints."
  };
}

export default function ToolsPage() {
  const store = useWorkspaceStore();
  const [selectedId, setSelectedId] = useState<string | null>(store.skills[0]?.id ?? null);
  const selected = store.skills.find((skill) => skill.id === selectedId) ?? null;
  const { draft, setDraft, dirty, reset, markSaved } = useDirty<SkillDefinition | Omit<SkillDefinition, "id" | "updatedAt">>(
    selected ?? blankSkill()
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const isNew = selectedId === null;

  useEffect(() => {
    if (!selectedId) return;
    const found = store.skills.find((skill) => skill.id === selectedId);
    if (found) reset(found);
  }, [selectedId, store.skills, reset]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.skills;
    return store.skills.filter((skill) =>
      [skill.name, skill.slug, skill.description, skill.category].some((value) =>
        value.toLowerCase().includes(q)
      )
    );
  }, [query, store.skills]);

  function selectSkill(skill: SkillDefinition) {
    setSelectedId(skill.id);
    reset(skill);
  }

  function createSkill() {
    setSelectedId(null);
    reset(blankSkill());
  }

  async function save() {
    setSaving(true);
    try {
      if (isNew) {
        const created = store.addSkill(draft as Omit<SkillDefinition, "id" | "updatedAt">);
        setSelectedId(created.id);
        reset(created);
        toast.success("Skill created");
      } else {
        store.updateSkill((draft as SkillDefinition).id, draft as Partial<SkillDefinition>);
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
    createSkill();
  }

  return (
    <AppShell inspector={<SkillInspector draft={draft} setDraft={setDraft} />}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name="sparkles" size={14} />}
          title="Skills"
          actions={
            <>
              <div className="hidden w-80 md:block">
                <SearchInput placeholder="Search skills" value={query} onChange={setQuery} />
              </div>
              <InspectorToggle label="Open settings panel" />
            </>
          }
        />

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-background">
            <div className="border-b border-border p-3 md:hidden">
              <SearchInput placeholder="Search skills" value={query} onChange={setQuery} />
            </div>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Skill Catalog
              </span>
              <Pill className="ml-auto">{store.skills.length}</Pill>
              <Tooltip content="New skill" side="bottom">
                <Button
                  aria-label="New skill"
                  className="h-7 px-2"
                  onClick={createSkill}
                  size="sm"
                  variant="ghost"
                >
                   <Icon name="plus" size={14} />
                  <span className="ml-1 text-xs">New</span>
                </Button>
              </Tooltip>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
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
                              : "border-transparent hover:bg-hover"
                          )}
                          onClick={() => selectSkill(skill)}
                          type="button"
                        >
                           <Icon name="sparkles" className="mt-0.5 shrink-0 text-muted-foreground" size={14} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{skill.name}</span>
                              {skill.slug === "web.search" ? <Pill tone="success">free</Pill> : null}
                            </span>
                            <span className="line-clamp-2 text-[11px] text-muted-foreground">
                              {skill.description}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span>Skills</span>
                 <Icon name="chevron-right" size={12} />
                <span className="max-w-72 truncate text-foreground">{draft.name}</span>
                <Pill tone={draft.status === "active" ? "success" : "default"}>{draft.status}</Pill>
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
                <div className="grid shrink-0 gap-3 border-b border-border bg-panel-raised px-4 py-3 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_180px_140px_140px]">
                  <Field label="Name">
                    <Input
                      className="h-8 text-sm font-medium"
                      onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
                      value={draft.name}
                    />
                  </Field>
                  <Field label="Slug">
                    <Input
                      className="h-8 font-mono"
                      onChange={(event) => setDraft((d) => ({ ...d, slug: event.target.value }))}
                      value={draft.slug}
                    />
                  </Field>
                  <Field label="Category">
                    <NativeSelect
                      ariaLabel="Category"
                      onChange={(value) => setDraft((d) => ({ ...d, category: value as SkillDefinition["category"] }))}
                      options={["search", "retrieval", "generation", "evaluation", "publishing", "custom"].map((value) => ({ label: value, value }))}
                      value={draft.category}
                    />
                  </Field>
                  <Field label="Status">
                    <NativeSelect
                      ariaLabel="Status"
                      onChange={(value) => setDraft((d) => ({ ...d, status: value as SkillDefinition["status"] }))}
                      options={["active", "draft", "archived"].map((value) => ({ label: value, value }))}
                      value={draft.status}
                    />
                  </Field>
                </div>

                <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel-raised px-4">
                   <Icon name="code" className="text-muted-foreground" size={14} />
                  <span className="text-xs font-medium text-foreground">Implementation Contract</span>
                </div>
                <Textarea
                  className="min-h-0 flex-1 resize-none rounded-none border-0 bg-background px-6 py-6 font-mono text-[13px] leading-6 focus-visible:ring-0"
                  onChange={(event) => setDraft((d) => ({ ...d, implementation: event.target.value }))}
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
  draft,
  setDraft
}: {
  draft: SkillDefinition | Omit<SkillDefinition, "id" | "updatedAt">;
  setDraft: Dispatch<SetStateAction<SkillDefinition | Omit<SkillDefinition, "id" | "updatedAt">>>;
}) {
  return (
    <div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
         <Icon name="code" className="text-muted-foreground" size={14} />
         <span className="text-xs font-semibold text-foreground">Skill Settings</span>
      </div>
      <div className="border-b border-border p-3">
        <Field label="Description">
          <Textarea
            className="min-h-28"
            onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
            value={draft.description}
          />
        </Field>
      </div>
      <div className="grid gap-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Auth">
            <NativeSelect
              ariaLabel="Auth"
              onChange={(value) => setDraft((d) => ({ ...d, auth: value as SkillDefinition["auth"] }))}
              options={["none", "api_key", "oauth"].map((value) => ({ label: value, value }))}
              value={draft.auth}
            />
          </Field>
          <Field label="Effect">
            <NativeSelect
              ariaLabel="Side effect"
              onChange={(value) => setDraft((d) => ({ ...d, sideEffect: value as SkillDefinition["sideEffect"] }))}
              options={["none", "read", "write", "external"].map((value) => ({ label: value, value }))}
              value={draft.sideEffect}
            />
          </Field>
        </div>
        <Field label="Input schema">
          <Textarea
            className="min-h-28 font-mono text-xs"
            onChange={(event) => setDraft((d) => ({ ...d, inputSchema: event.target.value }))}
            value={draft.inputSchema}
          />
        </Field>
        <Field label="Output schema">
          <Textarea
            className="min-h-28 font-mono text-xs"
            onChange={(event) => setDraft((d) => ({ ...d, outputSchema: event.target.value }))}
            value={draft.outputSchema}
          />
        </Field>
        <div className="rounded-md border border-border bg-panel-raised p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
             <Icon name="check" className="text-success" size={14} />
            Real search included
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            `web.search` is available without credentials and can be assigned to roles and workflow steps.
          </p>
        </div>
      </div>
    </div>
  );
}
