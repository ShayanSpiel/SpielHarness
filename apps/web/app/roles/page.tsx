"use client";

import type { Role, ArtifactType } from "@spielos/core";
import { Icon } from "../../components/icons";
import { InspectorToggle } from "../../components/inspector-toggle";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  Button,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  Pill,
  SearchInput,
  Textarea,
  Tooltip,
  cn
} from "@spielos/design-system";
import { AppShell } from "../../components/app-shell";
import { useWorkspaceStore } from "../../lib/use-workspace-store";

const artifactTypes: ArtifactType[] = [
  "draft",
  "brief",
  "research_report",
  "eval_report",
  "strategy_file",
  "asset"
];

function newRole(): Omit<Role, "id" | "orgId"> {
  return {
    name: "New Agent",
    description: "Configurable marketing role.",
    prompt: "Define this agent's job, constraints, skills, memory, and output contract.",
    skillIds: [],
    memoryPolicy: ["run"],
    inputArtifactTypes: ["draft"],
    outputArtifactTypes: ["draft"],
    modelId: "mistral-large-latest",
    status: "active",
    metadata: {}
  };
}

function roleId(role: Role | Omit<Role, "id" | "orgId">) {
  return "id" in role ? role.id : "new";
}

export default function RolesPage() {
  const store = useWorkspaceStore();
  const [selectedId, setSelectedId] = useState<string | null>(store.roles[0]?.id ?? null);
  const [draft, setDraft] = useState<Role | Omit<Role, "id" | "orgId">>(
    store.roles[0] ?? newRole()
  );
  const [query, setQuery] = useState("");
  const isNew = selectedId === null;

  useEffect(() => {
    if (!selectedId) return;
    const found = store.roles.find((role) => role.id === selectedId);
    if (found) setDraft(found);
  }, [selectedId, store.roles]);

  const filteredRoles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.roles;
    return store.roles.filter((role) =>
      [role.name, role.description, role.prompt].some((value) =>
        value.toLowerCase().includes(q)
      )
    );
  }, [query, store.roles]);

  const skillNames = useMemo(() => {
    const map = new Map(store.skills.map((skill) => [skill.id, skill.name]));
    return draft.skillIds.map((id: string) => map.get(id) ?? id);
  }, [draft.skillIds, store.skills]);

  function createRole() {
    setSelectedId(null);
    setDraft(newRole());
  }

  function selectRole(role: Role) {
    setSelectedId(role.id);
    setDraft(role);
  }

  function save() {
    if (isNew) {
      const created = store.addRole(draft as Omit<Role, "id" | "orgId">);
      setSelectedId(created?.id ?? null);
    } else {
      store.updateRole((draft as Role).id, draft as Partial<Role>);
    }
  }

  function remove() {
    if (isNew) return;
    store.deleteRole((draft as Role).id);
    createRole();
  }

  function toggleSkill(skillId: string) {
    setDraft((current) => {
      const exists = current.skillIds.includes(skillId);
      return {
        ...current,
        skillIds: exists
          ? current.skillIds.filter((id) => id !== skillId)
          : [...current.skillIds, skillId]
      };
    });
  }

  return (
    <AppShell
      inspector={
        <RoleInspector
          draft={draft}
          setDraft={setDraft}
          skillNames={skillNames}
          store={store}
          toggleSkill={toggleSkill}
        />
      }
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-panel-raised text-foreground">
            <Icon name="users" size={14} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">Roles</h1>
          </div>
          <div className="ml-auto hidden w-80 md:block">
            <SearchInput placeholder="Search roles" value={query} onChange={setQuery} />
          </div>
          <InspectorToggle label="Open settings panel" />
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-background">
            <div className="border-b border-border p-3 md:hidden">
              <SearchInput placeholder="Search roles" value={query} onChange={setQuery} />
            </div>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Agents
              </span>
              <Pill className="ml-auto">{store.roles.length}</Pill>
              <Tooltip content="New role" side="bottom">
                <Button
                  aria-label="New role"
                  className="h-7 px-2"
                  onClick={createRole}
                  size="sm"
                  variant="ghost"
                >
                   <Icon name="plus" size={14} />
                  <span className="ml-1 text-xs">New</span>
                </Button>
              </Tooltip>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {filteredRoles.length === 0 ? (
                <EmptyState className="py-10" description="No roles match this search." title="No matches" />
              ) : (
                <ul className="grid gap-0.5">
                  {filteredRoles.map((role) => {
                    const active = role.id === selectedId;
                    return (
                      <li key={role.id}>
                        <button
                          className={cn(
                            "group flex min-h-10 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                            active
                              ? "bg-selected text-foreground-strong"
                              : "text-foreground-muted hover:bg-hover hover:text-foreground"
                          )}
                          onClick={() => selectRole(role)}
                          type="button"
                        >
                           <Icon name="bot" className="mt-0.5 shrink-0" size={14} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{role.name}</span>
                              <Pill tone={role.status === "active" ? "success" : "default"} className="ml-auto">
                                {role.status === "active" ? "on" : "off"}
                              </Pill>
                            </span>
                            <span className="line-clamp-2 text-[11px] text-muted-foreground">
                              {role.description}
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
                <span>Roles</span>
                 <Icon name="chevron-right" size={12} />
                <span className="max-w-72 truncate text-foreground">{draft.name}</span>
                <Pill tone={isNew ? "warning" : "default"}>{isNew ? "new" : roleId(draft)}</Pill>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <NativeSelect
                  ariaLabel="Role enabled"
                  className="w-28"
                  onChange={(value) => setDraft((current) => ({ ...current, status: value === "active" ? "active" : "draft" }))}
                  options={[
                    { label: "enabled", value: "active" },
                    { label: "disabled", value: "draft" }
                  ]}
                  value={draft.status === "active" ? "active" : "draft"}
                />
                {!isNew ? (
                  <Tooltip content="Delete role" side="bottom">
                    <Button aria-label="Delete role" onClick={remove} size="icon" variant="ghost">
                       <Icon name="trash" size={14} />
                    </Button>
                  </Tooltip>
                ) : null}
                <Button onClick={save} size="md">
                   <Icon name="save" size={14} />
                   Save
                </Button>
              </div>
            </div>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="grid shrink-0 gap-3 border-b border-border bg-panel-raised px-4 py-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_150px]">
                <Field label="Name">
                  <Input
                    className="h-8 text-sm font-medium"
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    value={draft.name}
                  />
                </Field>
                <Field label="Description">
                  <Input
                    className="h-8"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, description: event.target.value }))
                    }
                    value={draft.description}
                  />
                </Field>
                <Field label="Model">
                  <NativeSelect
                    ariaLabel="Model"
                    onChange={(value) => setDraft((current) => ({ ...current, modelId: value }))}
                    options={store.models.map((model) => ({ label: model.label, value: model.model }))}
                    value={draft.modelId ?? ""}
                  />
                </Field>
                <Field label="Memory">
                  <Input
                    className="h-8"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        memoryPolicy: event.target.value.split(",").map((part) => part.trim()).filter(Boolean)
                      }))
                    }
                    value={draft.memoryPolicy.join(", ")}
                  />
                </Field>
              </div>

              <div className="flex min-h-0 flex-1">
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-panel-raised px-3">
                     <Icon name="file-text" className="text-muted-foreground" size={14} />
                    <span className="text-xs font-medium text-foreground">System Prompt</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {draft.prompt.length} chars
                    </span>
                  </div>
                  <Textarea
                    className="min-h-0 flex-1 resize-none rounded-none border-0 bg-background px-6 py-6 font-mono text-[13px] leading-6 focus-visible:ring-0"
                    onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
                    value={draft.prompt}
                  />
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </AppShell>
  );
}

function RoleInspector({
  draft,
  setDraft,
  skillNames,
  store,
  toggleSkill
}: {
  draft: Role | Omit<Role, "id" | "orgId">;
  setDraft: Dispatch<SetStateAction<Role | Omit<Role, "id" | "orgId">>>;
  skillNames: string[];
  store: ReturnType<typeof useWorkspaceStore>;
  toggleSkill: (skillId: string) => void;
}) {
  return (
    <div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
         <Icon name="sparkles" className="text-muted-foreground" size={14} />
        <span className="text-xs font-semibold text-foreground">Role Settings</span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground">
          {skillNames.length ? skillNames.join(", ") : "No skills assigned"}
        </span>
      </div>
      <div className="grid gap-1 p-2">
        {store.skills.map((skill) => {
          const selected = draft.skillIds.includes(skill.id);
          return (
            <button
              className={cn(
                "flex items-start gap-2 rounded-md border px-2 py-2 text-left transition-colors",
                selected ? "border-border bg-selected" : "border-transparent hover:bg-hover"
              )}
              key={skill.id}
              onClick={() => toggleSkill(skill.id)}
              type="button"
            >
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                  selected
                    ? "border-foreground-strong bg-foreground-strong text-background"
                    : "border-border"
                )}
              >
                 {selected ? <Icon name="check" size={12} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-foreground">{skill.name}</span>
                <span className="line-clamp-2 text-[11px] text-muted-foreground">
                  {skill.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="border-t border-border p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Input">
            <NativeSelect
              ariaLabel="Input artifact"
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  inputArtifactTypes: [value as ArtifactType]
                }))
              }
              options={artifactTypes.map((type) => ({ label: type, value: type }))}
              value={draft.inputArtifactTypes[0] ?? "draft"}
            />
          </Field>
          <Field label="Output">
            <NativeSelect
              ariaLabel="Output artifact"
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  outputArtifactTypes: [value as ArtifactType]
                }))
              }
              options={artifactTypes.map((type) => ({ label: type, value: type }))}
              value={draft.outputArtifactTypes[0] ?? "draft"}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
