"use client";

import { Icon } from "@spielos/design-system/components";
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
  Skeleton,
  SkeletonCard,
  SkeletonListItem,
  ToggleRow,
  Tooltip,
  cn,
  toast
} from "@spielos/design-system";
import { THEME_REGISTRY } from "@spielos/design-system";
import { useTheme } from "@spielos/design-system/hooks/use-theme";
import { useDirty } from "@spielos/design-system/hooks/use-dirty";
import { AppShell } from "../../components/app-shell";
import { ReasoningEffortControl } from "../../components/reasoning-effort-control";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import type { Model, ProviderModel } from "../../lib/workspace-data";
import { capabilitiesForModel, DEFAULT_MODEL_CAPABILITIES } from "@spielos/core";
import { SETTINGS_TABS, PROVIDER_OPTIONS, CONTEXT_PRESETS, compactTokens, type SettingsTab } from "./constants";
import { WorkspaceTab } from "./workspace-tab";
import { BillingTab } from "./billing-tab";

function emptyModel(): Omit<ProviderModel, "id"> {
  return {
    provider: "openai-compatible",
    label: "",
    model: "",
    baseUrl: "",
    secretEnvKey: null,
    enabled: true,
    capabilities: DEFAULT_MODEL_CAPABILITIES
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
    credentialHealth: "ready" | "missing" | "corrupted" | null;
    enabled: boolean;
  }>>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [presets, setPresets] = useState<Array<{ id: string; name: string; description: string; kind: string; icon: string; logo?: string; secretEnvKey?: string; baseUrl?: string; oauthReady?: boolean; availability?: "available" | "unavailable"; unavailableReason?: string; operations: Array<{ id: string }> }>>([]);
  const [connectionsSetupRequired, setConnectionsSetupRequired] = useState(false);
  const [variables, setVariables] = useState<Array<{ id: string; name: string; kind: "variable" | "secret_ref"; value: string | null; envKey: string | null; configured: boolean; description: string; enabled: boolean }>>([]);
  const [variablesLoading, setVariablesLoading] = useState(true);
  const [connectionDraft, setConnectionDraft] = useState({ presetId: "", name: "", kind: "api", baseUrl: "", secretEnvKey: "", operations: "" });
  const [variableDraft, setVariableDraft] = useState({ name: "", kind: "variable", value: "", description: "" });
  const [selectedId, setSelectedId] = useState<string | null>(store.models[0]?.id ?? null);
  const toProviderModel = useCallback(
    function (m: Model): ProviderModel {
      return { id: m.id, provider: m.provider, label: m.name, model: m.model, baseUrl: m.baseUrl ?? "", secretEnvKey: m.secretEnvKey, enabled: m.enabled, capabilities: capabilitiesForModel(m) };
    },
    []
  );
  const { draft, setDraft, dirty, reset, markSaved } = useDirty<ProviderModel | Omit<ProviderModel, "id">>(
    store.models[0] ? toProviderModel(store.models[0]) : emptyModel()
  );
  const [saving, setSaving] = useState(false);
  const [creatingModel, setCreatingModel] = useState(false);
  const [confirmModelDelete, setConfirmModelDelete] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState<typeof integrations[number] | null>(null);
  const [disconnectingBusy, setDisconnectingBusy] = useState(false);
  const selectedModel = selectedId ? store.models.find((m) => m.id === selectedId) : null;
  const isNew = selectedId === null;
  const isEnvModel = !isNew && (selectedModel?.config?.source === "environment");
  const hasApiKey = !isNew && selectedModel?.config?.hasApiKey === true;

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "connections" || tab === "variables" || tab === "models" || tab === "theme" || tab === "workspace" || tab === "billing" || tab === "team") setActiveTab(tab === "team" ? "workspace" : tab);
    setIntegrationsLoading(true);
    fetch("/api/integrations", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : { integrations: [] })
      .then((data: { integrations?: Array<Record<string, unknown>>; presets?: typeof presets; setupRequired?: boolean }) => {
        const enriched = (data.integrations ?? []).map((i) => ({
          id: String(i.id ?? ""),
          name: String(i.name ?? ""),
          kind: String(i.kind ?? ""),
          status: String(i.status ?? ""),
          secretEnvKey: i.secretEnvKey as string | null ?? null,
          secretConfigured: i.secretConfigured as boolean | null ?? null,
          operations: (i.operations ?? []) as typeof integrations[number]["operations"],
          baseUrl: i.baseUrl as string | null ?? null,
          logo: ((i as Record<string, unknown>).config as Record<string, unknown> | null)?.logo as string | null ?? null,
          account: i.account as string | null ?? null,
          credentialHealth: (i.credentialHealth === "ready" || i.credentialHealth === "missing" || i.credentialHealth === "corrupted" ? i.credentialHealth : null) as "ready" | "missing" | "corrupted" | null,
          enabled: Boolean(i.enabled),
        }));
        setIntegrations(enriched);
        setPresets(data.presets ?? []);
        setConnectionsSetupRequired(Boolean(data.setupRequired));
      })
      .catch(() => setIntegrations([]))
      .finally(() => setIntegrationsLoading(false));
  }, []);

  const reloadVariables = useCallback(() => {
    setVariablesLoading(true);
    return fetch("/api/variables", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : { variables: [] })
      .then((data: { variables?: typeof variables }) => setVariables(data.variables ?? []))
      .finally(() => setVariablesLoading(false));
  }, []);

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
    if (preset.availability === "unavailable") {
      toast.error(preset.unavailableReason ?? `${preset.name} is not available in this runtime.`);
      return;
    }
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

  useEffect(() => {
    if (creatingModel || selectedId || !store.models[0]) return;
    setSelectedId(store.models[0].id);
    reset(toProviderModel(store.models[0]));
  }, [creatingModel, selectedId, store.models, reset, toProviderModel]);

  function createModel() {
    setCreatingModel(true);
    setSelectedId(null);
    setAdvancedOpen(false);
    setApiKey("");
    setClearApiKey(false);
    reset(emptyModel());
  }

  async function save() {
    setSaving(true);
    try {
      const config = { capabilities: draft.capabilities };
      let extra: Record<string, unknown> = {};
      if (apiKey) {
        extra = { apiKey };
      } else if (clearApiKey) {
        extra = { apiKey: null };
      }
      if (isNew) {
        const created = await store.addModel({
          name: draft.label,
          provider: draft.provider as Model["provider"],
          model: draft.model,
          baseUrl: draft.baseUrl || null,
          secretEnvKey: draft.secretEnvKey || null,
          enabled: draft.enabled,
          config,
          ...extra
        });
        setSelectedId(created.id);
        reset(toProviderModel(created));
        setCreatingModel(false);
        setApiKey("");
        setClearApiKey(false);
        toast.success("Model created");
      } else {
        const id = (draft as ProviderModel).id;
        await store.updateModel(id, { name: draft.label, provider: draft.provider as Model["provider"], model: draft.model, baseUrl: draft.baseUrl || null, secretEnvKey: draft.secretEnvKey || null, enabled: draft.enabled, config, ...extra });
        markSaved();
        setApiKey("");
        setClearApiKey(false);
        toast.success("Model saved");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save model");
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
                {!store.ready ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <SkeletonListItem key={i} />
                  ))
                ) : (
                  <>
                {creatingModel ? (
                  <ListItem
                    active
                    metadata={<Pill tone="info">New</Pill>}
                    onClick={() => undefined}
                    subtitle={draft.model || draft.provider}
                    title={draft.label || "New model"}
                  />
                ) : null}
                {store.models.map((model) => {
                  const isEnv = model.config?.source === "environment";
                  return (
                    <ListItem
                      active={model.id === selectedId}
                      className={cn(isEnv && "opacity-60")}
                      key={model.id}
                      metadata={
                        <span className="flex shrink-0 items-center gap-1">
                          {isEnv ? <Pill className="text-3xs" tone="info">SpielOS</Pill> : <Pill className="text-3xs" tone="warning">Custom</Pill>}
                          <Pill tone={model.enabled ? "success" : "default"} className="text-3xs">
                            {model.enabled ? "On" : "Off"}
                          </Pill>
                        </span>
                      }
                      onClick={() => {
                        setCreatingModel(false);
                        setSelectedId(model.id);
                        setAdvancedOpen(false);
                        setApiKey("");
                        setClearApiKey(false);
                        reset(toProviderModel(model));
                      }}
                      subtitle={compactTokens(capabilitiesForModel(model).contextWindow)}
                      title={model.name}
                    />
                  );
                })}
                  </>
                )}
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
                    <div className="ms-auto flex items-center gap-1.5">
                      {!isNew && !isEnvModel ? (
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

                  {isEnvModel ? (
                    <Notice className="mb-4" tone="info" title="Default SpielOS model">
                      This is a built-in model provided by default. Switch it off to hide it from
                      chat, or create a custom model to override its settings.
                    </Notice>
                  ) : null}

                  <div className="grid gap-4">
                    <div className="grid items-start gap-3 md:grid-cols-2">
                      <Field label="Provider">
                        <NativeSelect
                          ariaLabel="Provider"
                          disabled={isEnvModel}
                          value={draft.provider}
                          options={PROVIDER_OPTIONS}
                          onChange={(value) => setDraft({ ...draft, provider: value })}
                        />
                      </Field>
                      <Field label="Enabled">
                        <ToggleRow
                          checked={draft.enabled}
                          description={draft.enabled ? "Available in chat" : "Hidden from chat"}
                          onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
                        />
                      </Field>
                      <Field label="Display name">
                        <Input
                          disabled={isEnvModel}
                          onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                          value={draft.label}
                        />
                      </Field>
                      <Field label="Model id">
                        <Input
                          disabled={isEnvModel}
                          onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                          value={draft.model}
                        />
                      </Field>
                      <div className="md:col-span-2 grid gap-3 md:grid-cols-2">
                        <Field hint="Name of the secure environment variable that contains this provider token (optional)." label="Environment key">
                          <div className="flex items-center gap-2">
                            <Input
                              className="min-w-0 flex-1 font-mono"
                              disabled={isEnvModel}
                              placeholder="API_KEY_REF"
                              onChange={(event) => setDraft({ ...draft, secretEnvKey: event.target.value || null })}
                              value={draft.secretEnvKey ?? ""}
                            />
                            <Pill className="h-8 shrink-0 px-2" tone={draft.secretEnvKey ? "success" : "default"}>
                              <Icon name={draft.secretEnvKey ? "shield" : "lock"} size={11} />
                              {draft.secretEnvKey ? "Secure" : "Not set"}
                            </Pill>
                          </div>
                        </Field>
                        <Field hint="Paste the API key directly. It will be encrypted and stored securely." label="API Key">
                          <div className="flex items-center gap-2">
                            <Input
                              className="min-w-0 flex-1"
                              disabled={isEnvModel}
                          onChange={(event) => { setApiKey(event.target.value); setClearApiKey(false); }}
                              type="password"
                              placeholder={hasApiKey && !apiKey ? "••••••••" : ""}
                              value={apiKey}
                            />
                            {apiKey ? (
                              <Pill className="h-8 shrink-0 px-2" tone="success">
                                <Icon name="shield" size={11} />
                                Encrypted
                              </Pill>
                            ) : hasApiKey && !apiKey ? (
                              <>
                                <Pill className="h-8 shrink-0 px-2" tone="success">
                                  <Icon name="shield" size={11} />
                                  Saved
                                </Pill>
                                <button className="text-3xs text-link underline" onClick={() => { setApiKey(""); setClearApiKey(true); }} type="button">
                                  Clear
                                </button>
                              </>
                            ) : null}
                          </div>
                        </Field>
                      </div>
                    </div>
                    <Field hint="Sets the default power level. Every chat can override it before the first message or mid-conversation." label="Reasoning power">
                      <div>
                        <ReasoningEffortControl
                          onChange={(reasoningEffort) => setDraft({ ...draft, capabilities: { ...draft.capabilities, reasoningEffort } })}
                          value={draft.capabilities.reasoningEffort}
                        />
                      </div>
                    </Field>
                    <button
                      aria-expanded={advancedOpen}
                      className="flex w-full items-center gap-3 rounded-md border border-border bg-panel-raised px-3 py-2.5 text-start transition-colors hover:bg-hover"
                      onClick={() => setAdvancedOpen((open) => !open)}
                      type="button"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-panel text-muted-foreground"><Icon name="settings" size={13} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-foreground">Advanced runtime</span>
                        <span className="block truncate text-3xs text-muted-foreground">{compactTokens(draft.capabilities.contextWindow)} context · {compactTokens(draft.capabilities.maxOutputTokens)} output · cleanup at {Math.round(draft.capabilities.compactionThreshold * 100)}%</span>
                      </span>
                      <Icon className="text-muted-foreground" name={advancedOpen ? "chevron-up" : "chevron-down"} size={13} />
                    </button>
                    {advancedOpen ? <div className="grid gap-5 rounded-md bg-panel-raised p-4">
                      <section className="grid gap-3">
                        <div>
                          <h3 className="text-xs font-medium text-foreground">Capacity</h3>
                          <p className="mt-0.5 text-2xs text-muted-foreground">The runtime uses these limits for active context, responses, and automatic cleanup.</p>
                        </div>
                        <div className="grid items-start gap-3 [grid-template-columns:repeat(auto-fit,minmax(var(--editor-field-min),1fr))]">
                          <Field label="Context window">
                            <div className="grid gap-1.5">
                              <Input min={1024} onChange={(event) => setDraft({ ...draft, capabilities: { ...draft.capabilities, contextWindow: Math.max(1024, Number(event.target.value) || 1024) } })} type="number" value={draft.capabilities.contextWindow} />
                              <div aria-label="Context window presets" className="grid grid-cols-3 gap-1 rounded-md bg-panel p-1">
                                {CONTEXT_PRESETS.map((preset) => <Button aria-pressed={draft.capabilities.contextWindow === preset.value} key={preset.value} onClick={() => setDraft({ ...draft, capabilities: { ...draft.capabilities, contextWindow: preset.value } })} size="xs" type="button" variant={draft.capabilities.contextWindow === preset.value ? "outline" : "ghost"}>{preset.label}</Button>)}
                              </div>
                            </div>
                          </Field>
                          <Field label="Maximum output per response">
                            <Input min={1} onChange={(event) => setDraft({ ...draft, capabilities: { ...draft.capabilities, maxOutputTokens: Math.max(1, Number(event.target.value) || 1) } })} type="number" value={draft.capabilities.maxOutputTokens} />
                          </Field>
                          <Field label="Cleanup threshold">
                            <Input aria-label="Cleanup threshold" max={0.95} min={0.5} onChange={(event) => setDraft({ ...draft, capabilities: { ...draft.capabilities, compactionThreshold: Math.min(0.95, Math.max(0.5, Number(event.target.value) || 0.8)) } })} step={0.05} type="number" value={draft.capabilities.compactionThreshold} />
                          </Field>
                        </div>
                      </section>
                      <section className="grid gap-3 border-t border-border pt-4">
                        <div>
                          <h3 className="text-xs font-medium text-foreground">Provider routing</h3>
                          <p className="mt-0.5 text-2xs text-muted-foreground">Only change these when using a proxy, compatible endpoint, or provider-specific token behavior.</p>
                        </div>
                        <div className="grid items-start gap-3 md:grid-cols-2">
                          <Field label="Base URL"><Input disabled={isEnvModel} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} value={draft.baseUrl ?? ""} /></Field>
                          <Field label="Token counter"><NativeSelect ariaLabel="Token counter" onChange={(value) => setDraft({ ...draft, capabilities: { ...draft.capabilities, tokenCounter: value as ProviderModel["capabilities"]["tokenCounter"] } })} options={[{ label: "Provider", value: "provider" }, { label: "Tiktoken", value: "tiktoken" }, { label: "Estimate", value: "estimate" }]} value={draft.capabilities.tokenCounter} /></Field>
                          {(draft.provider === "openai-compatible" || draft.provider === "custom") ? <Field label="Output token parameter"><NativeSelect ariaLabel="Output token parameter" onChange={(value) => setDraft({ ...draft, capabilities: { ...draft.capabilities, outputTokenParameter: value as ProviderModel["capabilities"]["outputTokenParameter"] } })} options={[{ label: "max_tokens", value: "max_tokens" }, { label: "max_completion_tokens", value: "max_completion_tokens" }]} value={draft.capabilities.outputTokenParameter} /></Field> : null}
                          {(draft.provider === "openai-compatible" || draft.provider === "custom") ? <Field hint="Preserve provider-specific metadata attached to function calls across tool-loop turns." label="Tool-call metadata"><NativeSelect ariaLabel="Tool-call metadata" onChange={(value) => setDraft({ ...draft, capabilities: { ...draft.capabilities, toolCallMetadata: value as ProviderModel["capabilities"]["toolCallMetadata"] } })} options={[{ label: "Normalized", value: "normalized" }, { label: "Preserve provider metadata", value: "provider_raw" }]} value={draft.capabilities.toolCallMetadata} /></Field> : null}
                        </div>
                      </section>
                      <section className="grid gap-3 border-t border-border pt-4">
                        <div>
                          <h3 className="text-xs font-medium text-foreground">Runtime capabilities</h3>
                          <p className="mt-0.5 text-2xs text-muted-foreground">Enable only features supported by this exact model and provider.</p>
                        </div>
                        <div className="grid gap-2 md:grid-cols-3">
                          <ToggleRow checked={draft.capabilities.toolCalling} description="Native tools" onCheckedChange={(checked) => setDraft({ ...draft, capabilities: { ...draft.capabilities, toolCalling: checked } })} />
                          <ToggleRow checked={draft.capabilities.parallelToolCalling} description="Parallel tools" onCheckedChange={(checked) => setDraft({ ...draft, capabilities: { ...draft.capabilities, parallelToolCalling: checked } })} />
                          <ToggleRow checked={draft.capabilities.reasoningSummaries} description="Reasoning summaries" onCheckedChange={(checked) => setDraft({ ...draft, capabilities: { ...draft.capabilities, reasoningSummaries: checked } })} />
                        </div>
                      </section>
                    </div> : null}
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
                    {integrationsLoading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <SkeletonCard key={i} />
                      ))
                    ) : (
                    presets.map((preset) => {
                      const matching = integrations.filter((integration) => integration.name === preset.name || integration.name.startsWith(`${preset.name} —`));
                      const added = matching.length > 0;
                      const connected = matching.some((integration) => integration.kind !== "oauth" || integration.credentialHealth === "ready");
                      const unavailable = preset.availability === "unavailable";
                      const action = unavailable ? "Unavailable" : preset.kind === "builtin" ? "Available" : connected ? "Connected" : preset.kind === "oauth" && added ? "Reconnect" : preset.kind === "oauth" ? "Connect" : added ? "Connected" : "Configure";
                      return (<div className="flex min-h-36 flex-col rounded-lg bg-panel-raised p-3 transition-colors hover:bg-hover" key={preset.id}>
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-panel shadow-panel">
                            {preset.logo ? <Image alt={`${preset.name} logo`} height={24} src={preset.logo} unoptimized width={24} /> : <Icon name={preset.icon} size={18} />}
                          </span>
                          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-foreground">{preset.name}</span><span className="mt-1 block text-2xs leading-relaxed text-muted-foreground">{preset.description}</span></span>
                        </div>
                        <div className="mt-auto flex items-center gap-2 pt-3">
                          <Pill tone={unavailable ? "warning" : preset.kind === "oauth" ? "primary" : preset.kind === "builtin" ? "success" : "default"}>{unavailable ? "Unavailable" : preset.kind === "oauth" ? "OAuth" : preset.kind === "builtin" ? "SpielOS" : preset.kind.toUpperCase()}</Pill>
                          <Button className="ms-auto" disabled={unavailable || preset.kind === "builtin" || connected} onClick={() => openPreset(preset)} size="sm" variant={preset.kind === "oauth" ? "primary" : "outline"}>{action}</Button>
                        </div>
                      </div>);
                    }))}
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
                  {integrationsLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="rounded-md bg-panel-raised p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <SkeletonListItem className="flex-1 px-0" lines={1} metadata={false} />
                        </div>
                        <Skeleton className="h-3 w-1/3" />
                        <Skeleton className="h-3 w-1/4" />
                      </div>
                    ))
                  ) : (
                  integrations.map((integration) => {
                    const connected = integration.status === "configured" && (integration.kind !== "oauth" || integration.credentialHealth === "ready");
                    const statusLabel = connected ? "Connected" : integration.kind === "oauth" ? "Needs reconnect" : "Needs config";
                    return (
                    <div className="rounded-md bg-panel-raised p-3" key={integration.id}>
                      <div className="flex items-center gap-2">
                        {integration.logo ? <Image alt={`${integration.name} logo`} height={18} src={integration.logo} unoptimized width={18} /> : <Icon name={integration.kind === "mcp" ? "server" : integration.kind === "oauth" ? "lock" : "globe"} size={14} />}
                        <span className="text-sm font-medium text-foreground">{integration.name}</span>
                        <Pill tone={connected ? "success" : "warning"} className="ms-auto">
                          {statusLabel}
                        </Pill>
                        <Tooltip content="Disconnect" side="bottom">
                          <Button aria-label={`Disconnect ${integration.name}`} icon="trash" onClick={() => setDisconnecting(integration)} size="icon-xs" variant="ghost" />
                        </Tooltip>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                        <div>Kind: {integration.kind}</div>
                        <div>{integration.kind === "oauth" ? `OAuth: ${integration.credentialHealth ?? "missing"}` : `Secret: ${integration.secretEnvKey ? `${integration.secretEnvKey} · ${integration.secretConfigured ? "ready" : "missing"}` : "not required"}`}</div>
                        {integration.baseUrl ? <div>Base URL: {integration.baseUrl}</div> : null}
                        <div>Operations: {(Array.isArray(integration.operations) ? integration.operations : []).map((operation) => operation.id).join(", ") || "none"}</div>
                      </div>
                    </div>
                    );
                  })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "variables" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-6 py-6">
              <div className="rounded-md border border-border bg-panel p-5">
                <div className="mb-4 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-panel text-muted-foreground">
                    <Icon name="key" size={13} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-foreground">Secrets & Variables</div>
                    <div className="text-3xs text-muted-foreground">
                      Variables are plain values; secret references point to deployment environment variables.
                    </div>
                  </div>
                  <Pill tone="default">{variables.length}</Pill>
                </div>

                <div className="grid gap-3 rounded-md bg-panel-raised p-3 sm:grid-cols-[1fr_auto_1fr]">
                  <Field label="Name">
                    <Input
                      placeholder="e.g. DEFAULT_SENDER"
                      onChange={(event) => setVariableDraft((d) => ({ ...d, name: event.target.value }))}
                      value={variableDraft.name}
                    />
                  </Field>
                  <Field label="Type">
                    <NativeSelect
                      ariaLabel="Variable type"
                      onChange={(kind) => setVariableDraft((d) => ({ ...d, kind }))}
                      options={[{ label: "Variable", value: "variable" }, { label: "Secret reference", value: "secret_ref" }]}
                      value={variableDraft.kind}
                    />
                  </Field>
                  <Field label={variableDraft.kind === "secret_ref" ? "Environment key" : "Value"}>
                    <Input
                      placeholder={variableDraft.kind === "secret_ref" ? "MY_API_KEY" : "value"}
                      onChange={(event) => setVariableDraft((d) => ({ ...d, value: event.target.value }))}
                      value={variableDraft.value}
                    />
                  </Field>
                  <div className="sm:col-span-3">
                    <Field label="Description (optional)">
                      <Input
                        onChange={(event) => setVariableDraft((d) => ({ ...d, description: event.target.value }))}
                        value={variableDraft.description}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-3">
                    <Button
                      disabled={!variableDraft.name.trim()}
                      icon="plus"
                      onClick={addVariable}
                      size="md"
                      variant="primary"
                    >
                      Add
                    </Button>
                  </div>
                </div>

                <div className="mt-4 grid gap-2">
                  {variablesLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-md bg-panel-raised p-3">
                        <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <Skeleton className="h-3.5 w-1/3" />
                            <Skeleton className="h-4 w-12 rounded-sm" />
                          </div>
                          <Skeleton className="h-3 w-1/4" />
                        </div>
                        <Skeleton className="h-5 w-14 rounded-sm" />
                      </div>
                    ))
                  ) : variables.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
                      <Icon name="key" size={20} />
                      <span>No variables yet. Add one above.</span>
                    </div>
                  ) : (
                    variables.map((variable) => (
                      <div
                        className="flex items-center gap-3 rounded-md bg-panel-raised p-3 transition-colors hover:bg-hover"
                        key={variable.id}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-panel text-muted-foreground">
                          <Icon name={variable.kind === "secret_ref" ? "lock" : "code"} size={14} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {variable.name}
                            </span>
                            <Pill
                              className="text-3xs"
                              tone={variable.kind === "secret_ref" ? "purple" : "default"}
                            >
                              {variable.kind === "secret_ref" ? "Secret" : "Variable"}
                            </Pill>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {variable.kind === "secret_ref"
                              ? variable.envKey ?? "—"
                              : variable.value ?? "—"}
                          </div>
                        </div>
                        <Pill
                          className="shrink-0"
                          tone={
                            variable.kind === "secret_ref" && !variable.configured
                              ? "warning"
                              : "success"
                          }
                        >
                          {variable.kind === "secret_ref"
                            ? variable.configured
                              ? "Ready"
                              : "Missing env"
                            : "Active"}
                        </Pill>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
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
                        "flex min-h-14 items-center gap-3 rounded-md px-3 py-2 text-start transition-colors duration-[var(--duration)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
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

        {activeTab === "billing" && <BillingTab />}

        {activeTab === "workspace" && <WorkspaceTab />}

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
      </div>
    </AppShell>
  );
}
