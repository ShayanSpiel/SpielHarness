"use client";

import type { Role } from "@spielos/core";
import { Icon, ENTITY_ICONS } from "@spielos/design-system/components";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  Button,
  ChoiceButton,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Inspector,
  InspectorBody,
  InspectorHeader,
  InspectorTabs,
  ListItem,
  NativeSelect,
  PageHeader,
  Pill,
  ToggleRow,
  Tooltip,
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
    modelId,
    status: "active",
    inputContract: { name: "Input", format: "markdown", body: "", required: true, multiple: false },
    outputContract: { name: "Output", format: "markdown", body: "", required: true, multiple: false },
    metadata: {}
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
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    setCreating(true);
    setSelectedId(null);
    reset(newRole(defaultModel));
  }

  function selectRole(role: Role) {
    setCreating(false);
    setSelectedId(role.id);
    reset(role);
  }

  async function save() {
    setSaving(true);
    try {
      if (isNew) {
        const created = await store.addRole(draft as Omit<Role, "id" | "orgId">);
        setSelectedId(created?.id ?? null);
        if (created) reset(created);
        setCreating(false);
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

  async function remove() {
    if (isNew) return;
    const id = (draft as Role).id;
    try {
      await store.deleteRole(id);
      const next = store.roles.find((role) => role.id !== id);
      setCreating(false);
      if (next) selectRole(next);
      else {
        setSelectedId(null);
        reset(newRole(defaultModel));
      }
      toast.success("Role deleted");
    } catch {
      toast.error("Failed to delete role");
    }
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
            count={store.roles.length + (creating ? 1 : 0)}
            onNew={createRole}
            newTooltip="New role"
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholder="Search roles"
          >
            {filteredRoles.length === 0 && !creating ? (
              <EmptyState className="py-10" description="No roles match this search." title="No matches" />
            ) : (
              <ul className="grid gap-0.5">
                {creating ? (
                  <ListItem
                    active
                    description={draft.description}
                    icon={ENTITY_ICONS.role}
                    metadata={<Pill tone="info">New</Pill>}
                    onClick={() => undefined}
                    title={draft.name}
                  />
                ) : null}
                {filteredRoles.map((role) => {
                  return <ListItem
                    active={role.id === selectedId}
                    description={role.description}
                    icon={ENTITY_ICONS.role}
                    key={role.id}
                    metadata={<Pill tone={role.status === "active" ? "success" : "default"}>{role.status === "active" ? "On" : "Off"}</Pill>}
                    onClick={() => selectRole(role)}
                    title={role.name}
                  />;
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
                  {draft.status === "active" ? "Enabled" : "Disabled"}
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
                    <Button aria-label="Delete role" icon="trash" onClick={() => setConfirmDelete(true)} size="icon-xs" variant="ghost" />
                  </Tooltip>
                ) : null}
                <Button disabled={!dirty} icon="save" loading={saving} onClick={save} size="md" variant={dirty ? "primary" : "outline"}>
                   Save
                 </Button>
              </div>
            </div>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(min(100%,var(--editor-field-min)),1fr))] items-end gap-3 border-b border-border bg-panel-raised px-4 py-3">
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
                    options={store.models.map((model) => ({ label: model.name, value: model.id }))}
                    value={draft.modelId ?? ""}
                  />
                </Field>
                <Field label="Memory">
                  <Input
                    className="h-8"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        metadata: { ...current.metadata, memoryPolicy: event.target.value }
                      }))
                    }
                    value={(draft.metadata?.memoryPolicy as string) ?? ""}
                  />
                </Field>
              </div>

              <div className="flex min-h-0 flex-1">
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-panel-raised px-3">
                     <Icon name="file-text" className="text-muted-foreground" size={14} />
                    <span className="text-xs font-medium text-foreground">System Prompt</span>
                    <div className="ml-auto flex items-center gap-2 text-3xs text-muted-foreground">
                      <span>{draft.prompt.length} chars</span>
                      <span className="select-none">@ to mention</span>
                    </div>
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
        <ConfirmDialog
          confirmLabel="Delete role"
          description={`Workflows using ${draft.name} will no longer be able to execute this role.`}
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
    <Inspector>
      <InspectorHeader
        actions={
          <Tooltip content="Configure this role's skills and input/output contracts." side="bottom">
            <Button aria-label="About role settings" icon="info" size="icon-xs" variant="ghost" />
          </Tooltip>
        }
        icon="reading-glass"
        title="Role settings"
      />
      <InspectorTabs
        onChange={(value) => setTab(value as typeof tab)}
        tabs={tabs}
        value={tab}
      />
      <InspectorBody>
        {tab === "skills" ? (
        <div className="p-2">
          <div className="grid gap-1">
            {store.skills.map((skill) => {
              const selected = draft.skillIds.includes(skill.id);
              const disabled = skill.status !== "active" && !selected;
              return (
                <ChoiceButton
                  description={skill.description}
                  disabled={disabled}
                  key={skill.id}
                  onClick={() => toggleSkill(skill.id)}
                  selected={selected}
                  selectionMode="multiple"
                  trailing={skill.status !== "active" ? <Pill>Off</Pill> : null}
                >
                  {skill.name}
                </ChoiceButton>
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
      </InspectorBody>
    </Inspector>
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
    <div className="p-3">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Icon className="shrink-0 text-muted-foreground" name={direction === "inputs" ? "arrow-down" : "arrow-up"} size={14} />
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
          <Field label="Format">
            <NativeSelect
              ariaLabel="Contract format"
              onChange={(format) => onChange({ format: format as RoleContractFormat })}
              options={formatOptions.map((format) => ({ label: format === "json" ? "JSON" : "Markdown", value: format }))}
              value={contract.format}
            />
          </Field>
          <div>
            <div className="grid gap-2 sm:grid-cols-2">
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
            <div className="overflow-hidden rounded-md border border-border bg-input transition-colors focus-within:border-[var(--focus-border)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]">
              <div className="flex h-8 items-center gap-2 border-b border-border bg-panel-raised px-2">
                <Pill className="text-3xs">{contract.format}</Pill>
                <span className="text-3xs text-muted-foreground">{contract.body.length} chars</span>
                <span className="ml-auto text-3xs text-muted-foreground select-none">
                  @ to mention
                </span>
              </div>
              <RichEditor
                className="min-h-56"
                density="field"
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
