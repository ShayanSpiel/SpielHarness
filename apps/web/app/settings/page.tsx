"use client";

import { Icon } from "../../components/icons";
import { useEffect, useState } from "react";
import {
  Button,
  Field,
  Input,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  Pill,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip
} from "@spielos/design-system";
import { THEME_REGISTRY } from "@spielos/design-system";
import { useTheme } from "@spielos/design-system/hooks/use-theme";
import { AppShell } from "../../components/app-shell";
import { useWorkspaceStore } from "../../lib/use-workspace-store";
import type { ProviderModel } from "../../lib/workspace-data";

function emptyModel(): Omit<ProviderModel, "id"> {
  return {
    provider: "Mistral",
    label: "Custom model",
    model: "mistral-large-latest",
    baseUrl: "",
    enabled: true
  };
}

export default function SettingsPage() {
  const store = useWorkspaceStore();
  const { theme: activeTheme, setTheme } = useTheme();
  const [integrations, setIntegrations] = useState<Array<{
    id: string;
    name: string;
    kind: string;
    status: string;
    secret: "redacted" | null;
    operations: string[];
    baseUrl: string | null;
  }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(store.models[0]?.id ?? null);
  const [draft, setDraft] = useState<ProviderModel | Omit<ProviderModel, "id">>(
    store.models[0] ?? emptyModel()
  );
  const isNew = selectedId === null;

  useEffect(() => {
    fetch("/api/integrations", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : { integrations: [] })
      .then((data: { integrations?: typeof integrations }) => setIntegrations(data.integrations ?? []))
      .catch(() => setIntegrations([]));
  }, []);

  function createModel() {
    setSelectedId(null);
    setDraft(emptyModel());
  }

  function save() {
    if (isNew) {
      store.addModel(draft as Omit<ProviderModel, "id">);
    } else {
      const id = (draft as ProviderModel).id;
      store.updateModel(id, draft as Partial<ProviderModel>);
    }
  }

  function remove() {
    if (isNew) return;
    const id = (draft as ProviderModel).id;
    store.deleteModel(id);
    createModel();
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

        <Tabs defaultValue="models" className="flex h-full min-h-0 flex-col overflow-hidden">
          <TabsList className="border-b border-border bg-panel-raised">
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="theme">Theme</TabsTrigger>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
          </TabsList>

          <TabsContent className="mt-0 min-h-0 flex-1 overflow-hidden" value="models">
            <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)]">
              <aside className="overflow-y-auto border-r border-border p-2">
                <Button className="mb-2 w-full" onClick={createModel} size="md" variant="outline">
                  <Icon name="plus" size={14} />
                  New model
                </Button>
                <ul className="space-y-1">
                  {store.models.map((model) => {
                    const active = model.id === selectedId;
                    return (
                      <li key={model.id}>
                        <button
                          className={`flex w-full items-start gap-2 rounded-md border px-2 py-2 text-left transition-colors ${
                            active
                              ? "border-border-strong bg-selected"
                              : "border-transparent hover:border-border hover:bg-hover"
                          }`}
                          onClick={() => {
                            setSelectedId(model.id);
                            setDraft(model);
                          }}
                          type="button"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{model.label}</span>
                              <Pill tone={model.enabled ? "success" : "default"} className="ml-auto text-[10px]">
                                {model.enabled ? "on" : "off"}
                              </Pill>
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {model.provider} / {model.model}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </aside>
              <section className="overflow-y-auto bg-background">
                <div className="mx-auto w-full max-w-2xl px-6 py-6">
                  <Panel>
                    <PanelHeader>
                      <PanelTitle>Model provider</PanelTitle>
                      <Pill tone="default" className="text-[10px]">
                        {isNew ? "new" : "edit"}
                      </Pill>
                      <div className="ml-auto flex items-center gap-1.5">
                        {!isNew ? (
                          <Tooltip content="Delete model" side="bottom">
                            <Button aria-label="Delete" onClick={remove} size="icon" variant="ghost">
                              <Icon name="trash" size={14} />
                            </Button>
                          </Tooltip>
                        ) : null}
                        <Button onClick={save} size="md">
                          <Icon name="save" size={14} />
                          Save
                        </Button>
                      </div>
                    </PanelHeader>
                    <PanelBody>
                      <div className="grid gap-3">
                        <Field label="Provider">
                          <Input
                            onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
                            value={draft.provider}
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
                        <Field label="Enabled">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={draft.enabled}
                              onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
                            />
                            <span className="text-xs text-muted-foreground">
                              {draft.enabled ? "Enabled" : "Disabled"}
                            </span>
                          </div>
                        </Field>
                      </div>
                    </PanelBody>
                  </Panel>
                </div>
              </section>
            </div>
          </TabsContent>

          <TabsContent className="mt-0 min-h-0 flex-1 overflow-y-auto" value="integrations">
            <div className="mx-auto w-full max-w-3xl px-6 py-6">
              <Panel>
                <PanelHeader>
                  <PanelTitle>Integrations</PanelTitle>
                  <Pill tone="default">{integrations.length}</Pill>
                </PanelHeader>
                <PanelBody>
                  <p className="text-xs text-muted-foreground">
                    Credentials are resolved server-side from environment variables. Skills reference operations, not secrets.
                  </p>
                  <div className="mt-4 grid gap-2">
                    {integrations.map((integration) => (
                      <div className="rounded-md border border-border bg-panel-raised p-3" key={integration.id}>
                        <div className="flex items-center gap-2">
                          <Icon name={integration.kind === "mcp_server" ? "server" : "tool"} size={14} />
                          <span className="text-sm font-medium text-foreground">{integration.name}</span>
                          <Pill tone={integration.status === "configured" ? "success" : "warning"} className="ml-auto">
                            {integration.status === "configured" ? "configured" : "needs env"}
                          </Pill>
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                          <div>Kind: {integration.kind}</div>
                          <div>Secret: {integration.secret === "redacted" ? "configured, redacted" : "not configured"}</div>
                          {integration.baseUrl ? <div>Base URL: {integration.baseUrl}</div> : null}
                          <div>Operations: {integration.operations.join(", ")}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </PanelBody>
              </Panel>
            </div>
          </TabsContent>

          <TabsContent className="mt-0 min-h-0 flex-1 overflow-y-auto" value="theme">
            <div className="mx-auto w-full max-w-2xl px-6 py-6">
              <Panel>
                <PanelHeader>
                  <PanelTitle>Theme</PanelTitle>
                </PanelHeader>
                <PanelBody>
                  <p className="text-xs text-muted-foreground">
                    Switch the global theme. All themes use the same semantic token system.
                  </p>
                  <div className="mt-4 grid gap-2">
                    {THEME_REGISTRY.map((t) => (
                      <button
                        className={`flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                          activeTheme === t.id
                            ? "border-ring bg-selected"
                            : "border-border bg-panel-raised hover:border-border-strong"
                        }`}
                        key={t.id}
                        onClick={() => setTheme(t.id)}
                        type="button"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">{t.label}</p>
                          <p className="text-xs text-muted-foreground">{t.group} · {t.mode}</p>
                        </div>
                        {activeTheme === t.id ? (
                          <Pill tone="primary" className="text-[10px]">active</Pill>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </PanelBody>
              </Panel>
            </div>
          </TabsContent>

          <TabsContent className="mt-0 min-h-0 flex-1 overflow-y-auto" value="workspace">
            <div className="mx-auto w-full max-w-2xl px-6 py-6">
              <Panel>
                <PanelHeader>
                  <PanelTitle>Workspace</PanelTitle>
                </PanelHeader>
                <PanelBody>
                  <p className="text-xs text-muted-foreground">
                    Reset clears all locally stored chats, artifacts, roles, models, and folders. This
                    cannot be undone.
                  </p>
                  <div className="mt-4">
                    <Button
                      onClick={() => {
                        if (confirm("Reset all workspace data? This cannot be undone.")) {
                          store.resetWorkspace();
                        }
                      }}
                      size="md"
                      variant="danger"
                    >
                      <Icon name="wand" size={14} />
                      Reset workspace
                    </Button>
                  </div>
                </PanelBody>
              </Panel>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
