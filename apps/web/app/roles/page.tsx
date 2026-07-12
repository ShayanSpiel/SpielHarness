"use client";

import type { Role } from "@spielos/core";
import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  Button,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Pill,
  ToggleRow,
  Tooltip,
  cn,
  toast
} from "@spielos/design-system";
import { useDirty } from "@spielos/design-system/hooks/use-dirty";
import { AppShell } from "../../components/app-shell";
import { SidebarListPanel } from "../../components/sidebar-list-panel";
import { RichEditor } from "../../components/rich-editor";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import type { RoleContractDefinition, RoleContractFormat } from "../../lib/workspace-data";

type RoleContractMetadata = {
  inputs?: RoleContractDefinition[];
  outputs?: RoleContractDefinition[];
};

function defaultContract(direction: "inputs" | "outputs"): RoleContractDefinition {
  return {
    name: direction === "inputs" ? "Input" : "Output",
    format: "markdown",
    body:
      direction === "inputs"
        ? "Describe the request, context, constraints, source material, and success criteria this role needs before it starts."
        : "Describe the exact deliverable this role must return, including structure, tone, required sections, and quality bar.",
    required: true,
    multiple: false
  };
}

function normalizeRoleContract(value: unknown, direction: "inputs" | "outputs"): RoleContractDefinition {
  const fallback = defaultContract(direction);
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const legacyFormat = record.format ?? record.dataType;
  const format: RoleContractFormat =
    legacyFormat === "json" || legacyFormat === "file" ? legacyFormat : "markdown";
  return {
    name: typeof record.name === "string" && record.name.trim() ? record.name : fallback.name,
    format,
    body:
      typeof record.body === "string" ? record.body :
      typeof record.description === "string" ? record.description :
      fallback.body,
    required: typeof record.required === "boolean" ? record.required : fallback.required,
    multiple: typeof record.multiple === "boolean" ? record.multiple : fallback.multiple
  };
}

function roleContracts(
  role: Role | Omit<Role, "id" | "orgId">,
  direction: "inputs" | "outputs"
): RoleContractDefinition[] {
  const savedContracts = (role.metadata?.contracts as RoleContractMetadata | undefined)?.[direction];
  if (savedContracts?.length) {
    return savedContracts.map((contract) => normalizeRoleContract(contract, direction));
  }
  return [defaultContract(direction)];
}

function newRole(modelId: string | null = null): Omit<Role, "id" | "orgId"> {
  return {
    name: "New Agent",
    description: "Configurable marketing role.",
    prompt: "Define this agent's job, constraints, skills, memory, and decision rules.",
    skillIds: [],
    memoryPolicy: ["run"],
    inputArtifactTypes: ["draft"],
    outputArtifactTypes: ["draft"],
    modelId,
    status: "active",
    metadata: {
      contracts: {
        inputs: [defaultContract("inputs")],
        outputs: [defaultContract("outputs")]
      }
    }
  };
}

export default function RolesPage() {
  const store = useWorkspaceStore();
  const defaultModel = store.models.find((model) => model.enabled)?.id ?? store.models[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(store.roles[0]?.id ?? null);
  const { draft, setDraft, dirty, reset, markSaved } = useDirty<Role | Omit<Role, "id" | "orgId">>(
    store.roles[0] ?? newRole(defaultModel)
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const isNew = selectedId === null;

  useEffect(() => {
    if (!selectedId) return;
    const found = store.roles.find((role) => role.id === selectedId);
    if (found) reset(found);
  }, [selectedId, store.roles, reset]);

  const filteredRoles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.roles;
    return store.roles.filter((role) =>
      [role.name, role.description, role.prompt].some((value) =>
        value.toLowerCase().includes(q)
      )
    );
  }, [query, store.roles]);

  function createRole() {
    setSelectedId(null);
    reset(newRole(defaultModel));
  }

  function selectRole(role: Role) {
    setSelectedId(role.id);
    reset(role);
  }

  async function save() {
    setSaving(true);
    try {
      if (isNew) {
        const created = await store.addRole(draft as Omit<Role, "id" | "orgId">);
        setSelectedId(created?.id ?? null);
        markSaved();
        toast.success("Role created");
      } else {
        await store.updateRole((draft as Role).id, draft as Partial<Role>);
        markSaved();
        toast.success("Role saved");
      }
    } catch {
      toast.error("Failed to save role");
    } finally {
      setSaving(false);
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
          store={store}
          toggleSkill={toggleSkill}
        />
      }
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name={ENTITY_ICONS.role} size={14} />}
          title="Roles"
        />

        <div className="flex min-h-0 flex-1">
          <SidebarListPanel
            title="Agents"
            count={store.roles.length}
            onNew={createRole}
            newTooltip="New role"
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholder="Search roles"
          >
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
                          <span className="line-clamp-2 text-2xs text-muted-foreground">
                            {role.description}
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
                <span>Roles</span>
                 <Icon name="chevron-right" size={12} />
                <span className="max-w-72 truncate text-foreground">{draft.name}</span>
                <Pill tone={draft.status === "active" ? "success" : "default"}>
                  {draft.status === "active" ? "enabled" : "disabled"}
                </Pill>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <ToggleRow
                  checked={draft.status === "active"}
                  description={draft.status === "active" ? "Enabled" : "Disabled"}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      status: checked ? "active" : "draft"
                    }))
                  }
                />
                {!isNew ? (
                  <Tooltip content="Delete role" side="bottom">
                    <Button aria-label="Delete role" onClick={remove} size="icon" variant="ghost">
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
                    options={store.models.map((model) => ({ label: model.label, value: model.id }))}
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
                    <span className="ml-auto text-3xs text-muted-foreground">
                      {draft.prompt.length} chars
                    </span>
                    <span className="ml-auto text-3xs text-muted-foreground select-none">
                      @ to mention
                    </span>
                  </div>
                  <RichEditor
                    mono
                    onChange={(v) => setDraft((current) => ({ ...current, prompt: v }))}
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
  store,
  toggleSkill
}: {
  draft: Role | Omit<Role, "id" | "orgId">;
  setDraft: Dispatch<SetStateAction<Role | Omit<Role, "id" | "orgId">>>;
  store: ReturnType<typeof useWorkspaceStore>;
  toggleSkill: (skillId: string) => void;
}) {
  const [tab, setTab] = useState<"skills" | "input" | "output">("skills");
  const inputContract = roleContracts(draft, "inputs")[0] ?? defaultContract("inputs");
  const outputContract = roleContracts(draft, "outputs")[0] ?? defaultContract("outputs");

  function updateContract(direction: "inputs" | "outputs", patch: Partial<RoleContractDefinition>) {
    setDraft((current) => {
      const currentContracts = (current.metadata?.contracts as RoleContractMetadata | undefined) ?? {};
      const currentContract = roleContracts(current, direction)[0] ?? defaultContract(direction);
      return {
        ...current,
        metadata: {
          ...current.metadata,
          contracts: {
            ...currentContracts,
            [direction]: [{ ...currentContract, ...patch }]
          }
        }
      };
    });
  }

  const tabs: Array<{ id: typeof tab; label: string; icon: string }> = [
    { id: "skills", label: "Skills", icon: "reading-glass" },
    { id: "input", label: "Input", icon: "arrow-down" },
    { id: "output", label: "Output", icon: "arrow-up" }
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
         <Icon name="reading-glass" className="text-muted-foreground" size={14} />
        <span className="text-xs font-semibold text-foreground">Role Settings</span>
        <Tooltip content="Configure this agent's skills, input contract, and output contract." side="bottom">
          <Button aria-label="About role settings" className="h-6 w-6 p-0" size="icon" variant="ghost">
            <Icon name="info" size={12} />
          </Button>
        </Tooltip>
      </div>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-panel-raised px-3">
        {tabs.map((entry) => (
          <button
            className={cn(
              "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
              tab === entry.id
                ? "bg-selected text-foreground-strong"
                : "text-muted-foreground hover:bg-hover hover:text-foreground"
            )}
            key={entry.id}
            onClick={() => setTab(entry.id)}
            type="button"
          >
            <Icon name={entry.icon} size={13} />
            {entry.label}
          </button>
        ))}
      </div>
      {tab === "skills" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="grid gap-1">
            {store.skills.map((skill) => {
              const selected = draft.skillIds.includes(skill.id);
              const disabled = skill.status !== "active" && !selected;
              return (
                <button
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-2 py-2 text-left transition-colors",
                    selected ? "border-border bg-selected" : "border-transparent hover:bg-hover",
                    skill.status !== "active" && "opacity-55"
                  )}
                  disabled={disabled}
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
                    <span className="flex items-center gap-2">
                      <span className="block min-w-0 flex-1 truncate text-[13px] text-foreground">{skill.name}</span>
                      {skill.status !== "active" ? <Pill className="shrink-0">disabled</Pill> : null}
                    </span>
                    <span className="line-clamp-2 text-2xs text-muted-foreground">
                      {skill.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <ContractEditor
          contract={tab === "input" ? inputContract : outputContract}
          direction={tab === "input" ? "inputs" : "outputs"}
          onChange={(patch) => updateContract(tab === "input" ? "inputs" : "outputs", patch)}
        />
      )}
    </div>
  );
}

function ContractEditor({
  contract,
  direction,
  onChange
}: {
  contract: RoleContractDefinition;
  direction: "inputs" | "outputs";
  onChange: (patch: Partial<RoleContractDefinition>) => void;
}) {
  const formatOptions: RoleContractFormat[] = ["markdown", "json"];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="rounded-md border border-border bg-panel p-3 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-panel-raised text-muted-foreground">
            <Icon name={direction === "inputs" ? "arrow-down" : "arrow-up"} size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {direction === "inputs" ? "Input contract" : "Output contract"}
            </div>
            <div className="text-2xs text-muted-foreground">Owned by this role</div>
          </div>
        </div>
        <div className="grid gap-3">
          <Field label="Name">
            <Input
              className="h-8"
              onChange={(event) => onChange({ name: event.target.value })}
              value={contract.name}
            />
          </Field>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-2xs font-medium text-muted-foreground">Format</span>
              <div className="flex rounded-md border border-border bg-background p-0.5">
                {formatOptions.map((format) => (
                  <button
                    className={cn(
                      "h-6 rounded px-2 text-2xs font-medium capitalize transition-colors",
                      contract.format === format
                        ? "bg-selected text-foreground-strong"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    key={format}
                    onClick={() => onChange({ format })}
                    type="button"
                  >
                    {format}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-2">
              <ToggleRow
                checked={contract.required}
                description="Required"
                onCheckedChange={(required) => onChange({ required })}
              />
              <ToggleRow
                checked={contract.multiple}
                description="Multiple"
                onCheckedChange={(multiple) => onChange({ multiple })}
              />
            </div>
          </div>
          <Field label="Contract body">
            <div className="overflow-hidden rounded-md border border-border bg-background">
              <div className="flex h-8 items-center gap-2 border-b border-border bg-panel-raised px-2">
                <Pill className="text-3xs">{contract.format}</Pill>
                <span className="text-3xs text-muted-foreground">{contract.body.length} chars</span>
                <span className="ml-auto text-3xs text-muted-foreground select-none">
                  @ to mention
                </span>
              </div>
              <RichEditor
                className="min-h-56"
                mono
                onChange={(v) => onChange({ body: v })}
                value={contract.body}
              />
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}
