export type SettingsTab = "models" | "connections" | "variables" | "billing" | "workspace" | "theme";

export const SETTINGS_TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: "models", label: "Models", icon: "cog" },
  { id: "connections", label: "Connections", icon: "link" },
  { id: "variables", label: "Secrets & Variables", icon: "lock-alt" },
  { id: "billing", label: "Billing", icon: "wallet" },
  { id: "workspace", label: "Workspace", icon: "building" },
  { id: "theme", label: "Theme", icon: "palette" },
];

export const PROVIDER_OPTIONS = [
  { label: "OpenAI Compatible", value: "openai-compatible" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Mistral", value: "mistral" },
  { label: "Custom", value: "custom" },
];

export const CONTEXT_PRESETS = [
  { label: "128K", value: 128_000 },
  { label: "200K", value: 200_000 },
  { label: "1M", value: 1_000_000 }
] as const;

export const TOAST_MESSAGES = {
  connectionAdded: "Connection added",
  connectionFailed: "Failed to add connection",
  disconnected: "Disconnected",
  disconnectFailed: "Failed to disconnect",
  variableAdded: "Variable added",
  variableFailed: "Failed to add variable",
  modelCreated: "Model created",
  modelSaved: "Model saved",
  modelDeleted: "Model deleted",
  modelFailed: "Failed to save model",
  modelDeleteFailed: "Failed to delete model",
  workspaceSaved: "Workspace settings saved",
  workspaceFailed: "Failed to save workspace settings",
  memberRemoved: "Member removed",
  memberFailed: "Failed to remove member",
  inviteSent: "Invitation sent",
  inviteFailed: "Failed to send invitation",
  inviteCancelled: "Invitation cancelled",
  inviteCancelFailed: "Failed to cancel invitation",
  starterSynced: "Starter files synchronized",
  starterSyncFailed: "Starter files could not be synchronized",
  workspaceReset: "Workspace reset",
  workspaceDeleted: "Workspace deleted"
} as const;

export function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString();
}
