"use client";

import { Icon, SETTINGS_TAB_ICONS } from "@spielos/design-system/components";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  ConfirmDialog,
  Field,
  Input,
  ListItem,
  NativeSelect,
  NavTabs,
  Notice,
  PageHeader,
  Pill,
  ResizableSidebar,
  SIDEBAR,
  ToggleRow,
  Tooltip,
  cn,
  toast
} from "@spielos/design-system";
import { THEME_REGISTRY } from "@spielos/design-system";
import { useTheme } from "@spielos/design-system/hooks/use-theme";
import { useDirty } from "@spielos/design-system/hooks/use-dirty";
import { AppShell } from "../../components/app-shell";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import type { Model, ProviderModel } from "../../lib/workspace-data";

type SettingsTab = "models" | "connections" | "variables" | "theme" | "workspace";

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: "models", label: "Models", icon: SETTINGS_TAB_ICONS.models },
  { id: "connections", label: "Connections", icon: SETTINGS_TAB_ICONS.integrations },
  { id: "variables", label: "Secrets & Variables", icon: "terminal" },
  { id: "theme", label: "Theme", icon: SETTINGS_TAB_ICONS.theme },
  { id: "workspace", label: "Workspace", icon: SETTINGS_TAB_ICONS.workspace },
];

const PROVIDER_OPTIONS = [
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Mistral", value: "mistral" },
  { label: "OpenAI Compatible", value: "openai-compatible" },
];

function emptyModel(): Omit<ProviderModel, "id"> {
  return {
    provider: "openai",
    label: "",
    model: "",
    baseUrl: "",
    secretEnvKey: null,
    enabled: true
  };
}

export default function SettingsPage() {
  const store = useWorkspaceStore();
  const { theme: activeTheme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>("models");
  const [integrations, setIntegrations] = useState<Array<{
    id: string;
    name: string;
    kind: string;
    status: string;
    secretEnvKey: string | null;
    secretConfigured: boolean | null;
    operations: Array<{ id: string; label?: string; effect?: string }>;
    baseUrl: string | null;
    logo: string | null;
    account: string | null;
    enabled: boolean;
  }>>([]);
  const [presets, setPresets] = useState<Array<{ id: string; name: string; description: string; kind: string; icon: string; logo?: string; secretEnvKey?: string; baseUrl?: string; oauthReady?: boolean; operations: Array<{ id: string }> }>>([]);
  const [connectionsSetupRequired, setConnectionsSetupRequired] = useState(false);
  const [variables, setVariables] = useState<Array<{ id: string; name: string; kind: "variable" | "secret_ref"; value: string | null; envKey: string | null; configured: boolean; description: string; enabled: boolean }>>([]);
  const [connectionDraft, setConnectionDraft] = useState({ presetId: "", name: "", kind: "api", baseUrl: "", secretEnvKey: "", operations: "" });
  const [variableDraft, setVariableDraft] = useState({ name: "", kind: "variable", value: "", description: "" });
  const [selectedId, setSelectedId] = useState<string | null>(store.models[0]?.id ?? null);
  const toProviderModel = useCallback(
    function (m: { id: string; provider: string; name: string; model: string; baseUrl: string | null; secretEnvKey: string | null; enabled: boolean }): ProviderModel {
      return { id: m.id, provider: m.provider, label: m.name, model: m.model, baseUrl: m.baseUrl ?? "", secretEnvKey: m.secretEnvKey, enabled: m.enabled };
    },
    []
  );
  const { draft, setDraft, dirty, reset, markSaved } = useDirty<ProviderModel | Omit<ProviderModel, "id">>(
    store.models[0] ? toProviderModel(store.models[0]) : emptyModel()
  );
  const [saving, setSaving] = useState(false);
  const [creatingModel, setCreatingModel] = useState(false);
  const [confirmModelDelete, setConfirmModelDelete] = useState(false);
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState<typeof integrations[number] | null>(null);
  const [disconnectingBusy, setDisconnectingBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const isNew = selectedId === null;

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "connections" || tab === "variables" || tab === "models" || tab === "theme" || tab === "workspace") setActiveTab(tab);
    fetch("/api/integrations", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : { integrations: [] })
      .then((data: { integrations?: typeof integrations; presets?: typeof presets; setupRequired?: boolean }) => { setIntegrations(data.integrations ?? []); setPresets(data.presets ?? []); setConnectionsSetupRequired(Boolean(data.setupRequired)); })
      .catch(() => setIntegrations([]));
  }, []);

  const reloadVariables = useCallback(() => fetch("/api/variables", { cache: "no-store" })
    .then((res) => res.ok ? res.json() : { variables: [] })
    .then((data: { variables?: typeof variables }) => setVariables(data.variables ?? [])), []);

  useEffect(() => { void reloadVariables(); }, [reloadVariables]);

  async function addConnection() {
    setConnectionSaving(true);
    try {
      const operations = connectionDraft.operations.split(",").map((value) => value.trim()).filter(Boolean).map((value) => ({ id: value, label: value, effect: value.includes("send") || value.includes("publish") ? "send" : value.includes("delete") ? "destructive" : "read" }));
      const payload = connectionDraft.presetId
        ? { presetId: connectionDraft.presetId }
        : { ...connectionDraft, operations };
      const response = await fetch("/api/integrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) return toast.error("Failed to add connection");
      const data = await response.json() as { integration: typeof integrations[number] };
      setIntegrations((current) => [...current, data.integration]);
      setConnectionDraft({ presetId: "", name: "", kind: "api", baseUrl: "", secretEnvKey: "", operations: "" });
      toast.success("Connection added");
    } catch {
      toast.error("Failed to add connection");
    } finally {
      setConnectionSaving(false);
    }
  }

  async function disconnectIntegration(integration: typeof integrations[number]) {
    setDisconnectingBusy(true);
    try {
      if (integration.kind === "oauth") {
        const presetId = presets.find((p) => integration.name === p.name || integration.name.startsWith(`${p.name} —`))?.id;
        if (presetId?.startsWith("google")) {
          await fetch("/api/auth/google/revoke", { method: "POST" });
        } else if (presetId === "notion") {
          await fetch("/api/auth/notion/revoke", { method: "POST" });
        }
      }
      const response = await fetch(`/api/integrations?id=${encodeURIComponent(integration.id)}`, { method: "DELETE" });
      if (!response.ok) return toast.error("Failed to disconnect");
      setIntegrations((current) => current.filter((i) => i.id !== integration.id));
      setDisconnecting(null);
      toast.success("Disconnected");
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setDisconnectingBusy(false);
    }
  }

  async function openPreset(preset: typeof presets[number]) {
    if (preset.kind === "builtin") return;
    if (connectionsSetupRequired) {
      toast.error("Apply migration 0005_connections.sql before configuring external connections.");
      return;
    }
    if (preset.kind === "oauth") {
      if (!preset.oauthReady) {
        toast.error(preset.id === "notion" ? "Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET to enable Notion login." : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google login.");
        return;
      }
      window.location.href = preset.id === "notion" ? "/api/auth/notion" : `/api/auth/google?integration=${encodeURIComponent(preset.id)}`;
      return;
    }
    // Keyless APIs (no secret env key) connect in one click
    if (!preset.secretEnvKey) {
      setConnectionSaving(true);
      try {
        const response = await fetch("/api/integrations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presetId: preset.id })
        });
        if (!response.ok) return toast.error(`Failed to connect ${preset.name}`);
        const data = await response.json() as { integration: typeof integrations[number] };
        setIntegrations((current) => [...current, data.integration]);
        toast.success(`${preset.name} connected`);
      } catch {
        toast.error(`Failed to connect ${preset.name}`);
      } finally {
        setConnectionSaving(false);
      }
      return;
    }
    setConnectionDraft({ presetId: preset.id, name: preset.name, kind: preset.kind, baseUrl: preset.baseUrl ?? "", secretEnvKey: preset.secretEnvKey ?? "", operations: preset.operations.map((operation) => operation.id).join(", ") });
    document.getElementById("custom-connection")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function addVariable() {
    const payload = variableDraft.kind === "secret_ref" ? { ...variableDraft, envKey: variableDraft.value, value: undefined } : variableDraft;
    const response = await fetch("/api/variables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) return toast.error("Failed to add variable");
    await reloadVariables();
    setVariableDraft({ name: "", kind: "variable", value: "", description: "" });
    toast.success("Variable added");
  }

  useEffect(() => {
    if (!selectedId) return;
    const found = store.models.find((m) => m.id === selectedId);
    if (found) reset(toProviderModel(found));
  }, [selectedId, store.models, reset, toProviderModel]);

  function createModel() {
    setCreatingModel(true);
    setSelectedId(null);
    reset(emptyModel());
  }

  async function save() {
    setSaving(true);
    try {
      if (isNew) {
        const created = await store.addModel({
          name: draft.label,
          provider: draft.provider as Model["provider"],
          model: draft.model,
          baseUrl: draft.baseUrl || null,
          secretEnvKey: draft.secretEnvKey || null,
          enabled: draft.enabled
        });
        setSelectedId(created.id);
        reset(toProviderModel(created));
        setCreatingModel(false);
        toast.success("Model created");
      } else {
        const id = (draft as ProviderModel).id;
        await store.updateModel(id, { name: draft.label, provider: draft.provider as Model["provider"], model: draft.model, baseUrl: draft.baseUrl || null, secretEnvKey: draft.secretEnvKey || null, enabled: draft.enabled });
        markSaved();
        toast.success("Model saved");
      }
    } catch {
      toast.error("Failed to save model");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (isNew) return;
    const id = (draft as ProviderModel).id;
    try {
      await store.deleteModel(id);
      const next = store.models.find((model) => model.id !== id);
      setCreatingModel(false);
      if (next) {
        setSelectedId(next.id);
        reset(toProviderModel(next));
      } else {
        setSelectedId(null);
        reset(emptyModel());
      }
      toast.success("Model deleted");
    } catch {
      toast.error("Failed to delete model");
    }
  }

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <PageHeader
          icon={<Icon name="settings" size={14} />}
          title="Settings"
          actions={
            <Pill tone="default">
              {store.models.length} models
            </Pill>
          }
        />

        <NavTabs
          tabs={SETTINGS_TABS}
          value={activeTab}
          onChange={(value) => setActiveTab(value as SettingsTab)}
        />

        {activeTab === "models" && (
          <div className="flex min-h-0 flex-1">
            <ResizableSidebar
              className="p-2"
              defaultWidth={SIDEBAR.LIST.NARROW_DEFAULT}
              sidebarId="settings-models"
              title="Models"
            >
              <Button className="mb-2 w-full" icon="plus" onClick={createModel} size="md" variant="outline">
                New model
              </Button>
              <ul className="space-y-1">
                {creatingModel ? (
                  <ListItem
                    active
                    metadata={<Pill tone="info">New</Pill>}
                    onClick={() => undefined}
                    subtitle={draft.model || draft.provider}
                    title={draft.label || "New model"}
                  />
                ) : null}
                {store.models.map((model) => (
                  <ListItem
                    active={model.id === selectedId}
                    key={model.id}
                    metadata={
                      <Pill tone={model.enabled ? "success" : "default"} className="shrink-0 text-3xs">
                        {model.enabled ? "On" : "Off"}
                      </Pill>
                    }
                    onClick={() => {
                      setCreatingModel(false);
                      setSelectedId(model.id);
                      reset(toProviderModel(model));
                    }}
                    subtitle={`${model.provider} / ${model.model}`}
                    title={model.name}
                  />
                ))}
              </ul>
            </ResizableSidebar>
            <section className="min-w-0 flex-1 overflow-y-auto bg-background">
              <div className="mx-auto w-full max-w-2xl px-6 py-6">
                <div className="rounded-md border border-border bg-panel p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-foreground">Model provider</h2>
                    <Pill tone={isNew ? "info" : "default"} className="text-3xs">
                      {isNew ? "New" : "Edit"}
                    </Pill>
                    <div className="ml-auto flex items-center gap-1.5">
                      {!isNew ? (
                        <Tooltip content="Delete model" side="bottom">
                          <Button aria-label="Delete" icon="trash" onClick={() => setConfirmModelDelete(true)} size="icon-xs" variant="ghost" />
                        </Tooltip>
                      ) : null}
                      <Button
                        disabled={!dirty || !draft.label.trim() || !draft.model.trim()}
                        icon="save"
                        loading={saving}
                        onClick={save}
                        size="md"
                        variant={dirty ? "primary" : "outline"}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <Field label="Provider">
                      <NativeSelect
                        ariaLabel="Provider"
                        value={draft.provider}
                        options={PROVIDER_OPTIONS}
                        onChange={(value) => setDraft({ ...draft, provider: value })}
                      />
                    </Field>
                    <Field label="Label">
                      <Input
                        onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                        value={draft.label}
                      />
                    </Field>
                    <Field label="Model id">
                      <Input
                        onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                        value={draft.model}
                      />
                    </Field>
                    <Field label="Base URL">
                      <Input
                        onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                        value={draft.baseUrl ?? ""}
                      />
                    </Field>
                    <Field label="API key (env variable name)">
                      <Input
                        placeholder="MISTRAL_API_KEY"
                        onChange={(event) => setDraft({ ...draft, secretEnvKey: event.target.value || null })}
                        value={draft.secretEnvKey ?? ""}
                      />
                    </Field>
                    <Field label="Enabled">
                      <ToggleRow
                        checked={draft.enabled}
                        description={draft.enabled ? "Enabled" : "Disabled"}
                        onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === "connections" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-6 py-6">
              <div className="rounded-md border border-border bg-panel p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Icon name="link" size={14} />
                  <h2 className="text-sm font-semibold text-foreground">Connections</h2>
                  <Pill tone="default">{integrations.length}</Pill>
                </div>
                <p className="text-xs text-muted-foreground">
                  Connect an API, MCP server, or OAuth account once. Its operations then appear in every skill.
                </p>
                {connectionsSetupRequired ? <Notice className="mt-3" tone="warning" title="Connection storage is unavailable">Apply <code>0005_connections.sql</code>; native SpielOS tools remain available.</Notice> : null}
                <div className="mt-4">
                  <div className="mb-2 text-xs font-medium text-foreground">Add an integration</div>
                  <div className="grid gap-2 md:grid-cols-3">
                    {presets.map((preset) => {
                      const added = integrations.some((integration) => integration.name === preset.name || integration.name.startsWith(`${preset.name} —`));
                      const action = preset.kind === "builtin" ? "Available" : added ? "Connected" : preset.kind === "oauth" ? "Connect" : "Configure";
                      return <div className="flex min-h-36 flex-col rounded-lg bg-panel-raised p-3 transition-colors hover:bg-hover" key={preset.id}>
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-panel shadow-panel">
                            {preset.logo ? <Image alt={`${preset.name} logo`} height={24} src={preset.logo} width={24} /> : <Icon name={preset.icon} size={18} />}
                          </span>
                          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-foreground">{preset.name}</span><span className="mt-1 block text-2xs leading-relaxed text-muted-foreground">{preset.description}</span></span>
                        </div>
                        <div className="mt-auto flex items-center gap-2 pt-3">
                          <Pill tone={preset.kind === "oauth" ? "primary" : preset.kind === "builtin" ? "success" : "default"}>{preset.kind === "oauth" ? "OAuth" : preset.kind === "builtin" ? "SpielOS" : preset.kind.toUpperCase()}</Pill>
                          <Button className="ml-auto" disabled={preset.kind === "builtin" || added} onClick={() => openPreset(preset)} size="sm" variant={preset.kind === "oauth" ? "primary" : "outline"}>{action}</Button>
                        </div>
                      </div>;
                    })}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 rounded-md bg-panel-raised p-3 md:grid-cols-2" id="custom-connection">
                  <Field label="Name"><Input placeholder="Buffer MCP" value={connectionDraft.name} onChange={(event) => setConnectionDraft((d) => ({ ...d, name: event.target.value }))} /></Field>
                  <Field label="Type"><NativeSelect ariaLabel="Connection type" value={connectionDraft.kind} options={["api", "mcp", "oauth"].map((value) => ({ label: value.toUpperCase(), value }))} onChange={(kind) => setConnectionDraft((d) => ({ ...d, kind }))} /></Field>
                  <Field label="Base URL (optional)"><Input placeholder="https://..." value={connectionDraft.baseUrl} onChange={(event) => setConnectionDraft((d) => ({ ...d, baseUrl: event.target.value }))} /></Field>
                  <Field label="Secret environment key (optional)"><Input placeholder="BUFFER_API_KEY" value={connectionDraft.secretEnvKey} onChange={(event) => setConnectionDraft((d) => ({ ...d, secretEnvKey: event.target.value }))} /></Field>
                  <div className="md:col-span-2"><Field label="Operations"><Input placeholder="buffer.publish, buffer.list_channels" value={connectionDraft.operations} onChange={(event) => setConnectionDraft((d) => ({ ...d, operations: event.target.value }))} /></Field></div>
                  <div className="md:col-span-2"><Button disabled={!connectionDraft.name.trim()} icon="plus" loading={connectionSaving} onClick={addConnection} size="md" variant="primary">Save connection</Button></div>
                </div>
                <div className="mt-4 grid gap-2">
                  {integrations.map((integration) => (
                    <div className="rounded-md bg-panel-raised p-3" key={integration.id}>
                      <div className="flex items-center gap-2">
                        {integration.logo ? <Image alt={`${integration.name} logo`} height={18} src={integration.logo} width={18} /> : <Icon name={integration.kind === "mcp" ? "server" : integration.kind === "oauth" ? "lock" : "globe"} size={14} />}
                        <span className="text-sm font-medium text-foreground">{integration.name}</span>
                        <Pill tone={integration.status === "configured" ? "success" : "warning"} className="ml-auto">
                          {integration.status === "configured" ? "Connected" : integration.kind === "oauth" ? "Needs login" : "Needs config"}
                        </Pill>
                        <Tooltip content="Disconnect" side="bottom">
                          <Button aria-label={`Disconnect ${integration.name}`} icon="trash" onClick={() => setDisconnecting(integration)} size="icon-xs" variant="ghost" />
                        </Tooltip>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                        <div>Kind: {integration.kind}</div>
                        <div>Secret: {integration.secretEnvKey ? `${integration.secretEnvKey} · ${integration.secretConfigured ? "ready" : "missing"}` : "not required"}</div>
                        {integration.baseUrl ? <div>Base URL: {integration.baseUrl}</div> : null}
                        <div>Operations: {(Array.isArray(integration.operations) ? integration.operations : []).map((operation) => operation.id).join(", ") || "none"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "variables" && (
          <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-3xl px-6 py-6"><div className="rounded-md border border-border bg-panel p-5">
            <div className="flex items-center gap-2"><Icon name="terminal" size={14} /><h2 className="text-sm font-semibold text-foreground">Secrets & Variables</h2><Pill>{variables.length}</Pill></div>
            <p className="mt-2 text-xs text-muted-foreground">Variables are workspace configuration. Secret references point to deployment environment variables; their values are never stored or shown here.</p>
            <div className="mt-4 grid gap-3 rounded-md bg-panel-raised p-3 md:grid-cols-2">
              <Field label="Name"><Input placeholder="Default sender" value={variableDraft.name} onChange={(event) => setVariableDraft((d) => ({ ...d, name: event.target.value }))} /></Field>
              <Field label="Type"><NativeSelect ariaLabel="Variable type" value={variableDraft.kind} options={[{ label: "Variable", value: "variable" }, { label: "Secret reference", value: "secret_ref" }]} onChange={(kind) => setVariableDraft((d) => ({ ...d, kind }))} /></Field>
              <Field label={variableDraft.kind === "secret_ref" ? "Environment key" : "Value"}><Input placeholder={variableDraft.kind === "secret_ref" ? "BUFFER_API_KEY" : "marketing@company.com"} value={variableDraft.value} onChange={(event) => setVariableDraft((d) => ({ ...d, value: event.target.value }))} /></Field>
              <Field label="Description (optional)"><Input value={variableDraft.description} onChange={(event) => setVariableDraft((d) => ({ ...d, description: event.target.value }))} /></Field>
              <div className="md:col-span-2"><Button disabled={!variableDraft.name.trim()} onClick={addVariable} size="md" variant="primary"><Icon name="plus" size={14} />Add</Button></div>
            </div>
            <div className="mt-4 grid gap-2">{variables.map((variable) => <div className="flex items-center gap-3 rounded-md bg-panel-raised p-3" key={variable.id}><Icon name={variable.kind === "secret_ref" ? "lock" : "code"} size={14} /><div className="min-w-0 flex-1"><div className="text-sm font-medium text-foreground">{variable.name}</div><div className="truncate text-xs text-muted-foreground">{variable.kind === "secret_ref" ? variable.envKey : variable.value}</div></div><Pill tone={variable.kind === "secret_ref" && !variable.configured ? "warning" : "success"}>{variable.kind === "secret_ref" ? variable.configured ? "Ready" : "Missing env" : "Variable"}</Pill></div>)}</div>
          </div></div></div>
        )}

        {activeTab === "theme" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl px-6 py-6">
              <div className="rounded-md border border-border bg-panel p-5">
                <div className="mb-4 flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">Theme</h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  Switch the global theme. All themes use the same semantic token system.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {THEME_REGISTRY.map((t) => (
                    <button
                      aria-pressed={activeTheme === t.id}
                      className={cn(
                        "flex min-h-14 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-[var(--duration)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
                        activeTheme === t.id
                          ? "bg-selected text-foreground-strong"
                          : "bg-panel-raised hover:bg-hover"
                      )}
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      type="button"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground">{t.label}</p>
                        <p className="text-2xs text-muted-foreground">{t.group} · {t.mode}</p>
                      </div>
                      <span
                        aria-hidden
                        className="flex h-7 w-20 shrink-0 items-center gap-1 rounded-sm border border-border bg-background px-1.5"
                        data-theme={t.id}
                      >
                        <span className="h-3 flex-1 rounded-sm bg-panel" />
                        <span className="h-3 w-3 rounded-sm bg-primary" />
                        <span className="h-3 w-3 rounded-sm bg-success" />
                        <span className="h-3 w-3 rounded-sm bg-destructive" />
                      </span>
                      {activeTheme === t.id ? (
                        <Icon name="check" className="shrink-0 text-primary" size={12} />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "workspace" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl px-6 py-6">
              <div className="rounded-md border border-border bg-panel p-5">
                <div className="mb-4 flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">Workspace</h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  Reset clears all locally stored chats, artifacts, roles, models, and folders. This
                  cannot be undone.
                </p>
                <div className="mt-4">
                  <Button
                    onClick={() => setResetOpen(true)}
                    size="md"
                    variant="danger"
                  >
                    <Icon name="wand" size={14} />
                    Reset workspace
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        <ConfirmDialog
          confirmLabel="Delete model"
          description={`Roles configured to use ${draft.label || "this model"} will need a replacement model before they can run.`}
          onConfirm={async () => {
            setConfirmModelDelete(false);
            await remove();
          }}
          onOpenChange={setConfirmModelDelete}
          open={confirmModelDelete}
          title={`Delete ${draft.label || "this model"}?`}
        />
        <ConfirmDialog
          busy={disconnectingBusy}
          confirmLabel="Disconnect"
          description={disconnecting ? `Skills using ${disconnecting.name} will stop working until it is connected again.` : "This connection will be removed."}
          onConfirm={async () => {
            if (disconnecting) await disconnectIntegration(disconnecting);
          }}
          onOpenChange={(open) => { if (!open) setDisconnecting(null); }}
          open={disconnecting !== null}
          title={disconnecting ? `Disconnect ${disconnecting.name}?` : "Disconnect connection?"}
        />
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
      </div>
    </AppShell>
  );
}
