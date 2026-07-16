"use client";

import { Button, Icon, Pill, Popover, PopoverContent, PopoverTrigger, ProviderLogo, cn } from "@spielos/design-system";
import { capabilitiesForModel, type Model } from "@spielos/core";
import { useMemo, useState } from "react";

function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  return `${Math.round(value / 1_000)}K`;
}

function providerLabel(provider: string): string {
  if (provider === "openai-compatible") return "OpenAI Compatible";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function ChatModelPicker({
  models,
  value,
  onChange,
}: {
  models: Model[];
  value: string;
  onChange: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = models.find((model) => model.id === value) ?? models[0] ?? null;
  const groups = useMemo(() => {
    const grouped = new Map<string, Model[]>();
    for (const model of models) grouped.set(model.provider, [...(grouped.get(model.provider) ?? []), model]);
    return Array.from(grouped.entries());
  }, [models]);

  if (!selected) return null;
  const selectedCapabilities = capabilitiesForModel(selected);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-label={`Choose chat model. Current model: ${selected.name}`}
          className="max-w-48"
          icon="server"
          size="sm"
          type="button"
          variant="subtle"
        >
          <span className="truncate">{selected.name}</span>
          <span className="shrink-0 text-3xs tabular-nums text-muted-foreground">{compactTokens(selectedCapabilities.contextWindow)}</span>
          <Icon className={cn("shrink-0 text-muted-foreground transition-transform duration-[var(--duration)]", open && "rotate-180")} name="chevron-down" size={10} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1.5" side="top">
        <div className="flex items-center gap-2 px-2 pb-2 pt-1">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-panel text-muted-foreground">
            <Icon name="server" size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-foreground">Choose model</div>
            <div className="text-3xs text-muted-foreground">Context and capabilities update instantly.</div>
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {groups.map(([provider, providerModels]) => (
            <section className="mb-1 last:mb-0" key={provider}>
                <div className="flex items-center gap-1.5 px-2 py-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
                  <ProviderLogo provider={provider} size={10} />
                  <span>{providerLabel(provider)}</span>
                <span className="ml-auto tabular-nums">{providerModels.length}</span>
              </div>
              <div className="grid gap-0.5">
                {providerModels.map((model) => {
                  const capabilities = capabilitiesForModel(model);
                  const active = model.id === selected.id;
                  const source = model.config?.source === "environment" || model.secretEnvKey ? "Environment" : null;
                  return (
                    <button
                      aria-checked={active}
                      className={cn(
                        "group grid w-full grid-cols-[1fr_auto] items-center gap-x-3 rounded-md px-2 py-2 text-left transition-colors duration-[var(--duration)]",
                        active ? "bg-selected text-foreground" : "text-foreground hover:bg-hover"
                      )}
                      key={model.id}
                      onClick={() => {
                        onChange(model.id);
                        setOpen(false);
                      }}
                      role="menuitemradio"
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-medium">{model.name}</span>
                          {source ? <Pill className="h-4 text-3xs" tone="default">{source}</Pill> : null}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-3xs text-muted-foreground">{model.model}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Pill className="tabular-nums" tone={capabilities.contextWindow >= 1_000_000 ? "info" : "default"}>
                          {compactTokens(capabilities.contextWindow)}
                        </Pill>
                        <Icon className={cn("text-info transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-30")} name="check" size={12} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
