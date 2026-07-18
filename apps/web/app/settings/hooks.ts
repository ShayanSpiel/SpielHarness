"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@spielos/design-system";

export type Integration = {
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
};

export type IntegrationPreset = {
  id: string;
  name: string;
  description: string;
  kind: string;
  icon: string;
  logo?: string;
  secretEnvKey?: string;
  baseUrl?: string;
  oauthReady?: boolean;
  availability?: "available" | "unavailable";
  unavailableReason?: string;
  operations: Array<{ id: string }>;
};

export function useIntegrations() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [presets, setPresets] = useState<IntegrationPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/integrations", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : { integrations: [] })
      .then((data: { integrations?: Array<Record<string, unknown>>; presets?: IntegrationPreset[]; setupRequired?: boolean }) => {
        if (cancelled) return;
        const enriched = (data.integrations ?? []).map((i) => ({
          id: String(i.id ?? ""),
          name: String(i.name ?? ""),
          kind: String(i.kind ?? ""),
          status: String(i.status ?? ""),
          secretEnvKey: i.secretEnvKey as string | null ?? null,
          secretConfigured: i.secretConfigured as boolean | null ?? null,
          operations: (i.operations ?? []) as Integration["operations"],
          baseUrl: i.baseUrl as string | null ?? null,
          logo: ((i as Record<string, unknown>).config as Record<string, unknown> | null)?.logo as string | null ?? null,
          account: i.account as string | null ?? null,
          enabled: Boolean(i.enabled),
        }));
        setIntegrations(enriched);
        setPresets(data.presets ?? []);
        setSetupRequired(Boolean(data.setupRequired));
      })
      .catch(() => { if (!cancelled) setIntegrations([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const addConnection = useCallback(async (draft: { presetId: string; name: string; kind: string; baseUrl: string; secretEnvKey: string; operations: string }) => {
    setSaving(true);
    try {
      const operations = draft.operations.split(",").map((v) => v.trim()).filter(Boolean).map((v) => ({ id: v, label: v, effect: v.includes("send") || v.includes("publish") ? "send" : v.includes("delete") ? "destructive" : "read" }));
      const payload = draft.presetId ? { presetId: draft.presetId } : { ...draft, operations };
      const res = await fetch("/api/integrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { toast.error("Failed to add connection"); return false; }
      const data = await res.json() as { integration: Integration };
      setIntegrations((c) => [...c, data.integration]);
      toast.success("Connection added");
      return true;
    } catch {
      toast.error("Failed to add connection");
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const disconnect = useCallback(async (integration: Integration) => {
    try {
      if (integration.kind === "oauth") {
        const preset = presets.find((p) => integration.name === p.name || integration.name.startsWith(`${p.name} —`));
        if (preset?.id.startsWith("google")) {
          await fetch("/api/auth/google/revoke", { method: "POST" });
        } else if (preset?.id === "notion") {
          await fetch("/api/auth/notion/revoke", { method: "POST" });
        }
      }
      const res = await fetch(`/api/integrations?id=${encodeURIComponent(integration.id)}`, { method: "DELETE" });
      if (!res.ok) { toast.error("Failed to disconnect"); return false; }
      setIntegrations((c) => c.filter((i) => i.id !== integration.id));
      toast.success("Disconnected");
      return true;
    } catch {
      toast.error("Failed to disconnect");
      return false;
    }
  }, [presets]);

  const openPreset = useCallback(async (preset: IntegrationPreset) => {
    if (preset.kind === "builtin") return;
    if (preset.availability === "unavailable") {
      toast.error(preset.unavailableReason ?? `${preset.name} is not available in this runtime.`);
      return;
    }
    if (setupRequired) {
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
    if (!preset.secretEnvKey) {
      setSaving(true);
      try {
        const res = await fetch("/api/integrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ presetId: preset.id }) });
        if (!res.ok) { toast.error(`Failed to connect ${preset.name}`); return; }
        const data = await res.json() as { integration: Integration };
        setIntegrations((c) => [...c, data.integration]);
        toast.success(`${preset.name} connected`);
      } catch {
        toast.error(`Failed to connect ${preset.name}`);
      } finally {
        setSaving(false);
      }
      return;
    }
    return preset;
  }, [setupRequired]);

  return { integrations, presets, loading, setupRequired, saving, addConnection, disconnect, openPreset };
}

export type Variable = {
  id: string;
  name: string;
  kind: "variable" | "secret_ref";
  value: string | null;
  envKey: string | null;
  configured: boolean;
  description: string;
  enabled: boolean;
};

export function useVariables() {
  const [variables, setVariables] = useState<Variable[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    return fetch("/api/variables", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : { variables: [] })
      .then((data: { variables?: Variable[] }) => setVariables(data.variables ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const addVariable = useCallback(async (draft: { name: string; kind: string; value: string; description: string }) => {
    const payload = draft.kind === "secret_ref" ? { ...draft, envKey: draft.value, value: undefined } : draft;
    const res = await fetch("/api/variables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) { toast.error("Failed to add variable"); return false; }
    await reload();
    toast.success("Variable added");
    return true;
  }, [reload]);

  return { variables, loading, addVariable, reload };
}
