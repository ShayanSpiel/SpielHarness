"use client";

import { Icon } from "@spielos/design-system/components";
import { useCallback, useEffect, useState } from "react";
import {
  Notice,
  Pill,
  Spinner,
} from "@spielos/design-system";

type CreditInfo = {
  balance: number;
  lifetimeUsed: number;
};

type UsageDay = {
  day: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
};

export function BillingTab() {
  const [credits, setCredits] = useState<CreditInfo | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [usage, setUsage] = useState<UsageDay[]>([]);
  const [usageLoading, setUsageLoading] = useState(true);

  const fetchCredits = useCallback(async () => {
    setCreditsLoading(true);
    try {
      const res = await fetch("/api/billing/credits", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as CreditInfo;
        setCredits(data);
      }
    } catch {
      // silent
    } finally {
      setCreditsLoading(false);
    }
  }, []);

  const fetchUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const res = await fetch("/api/billing/usage", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as { daily: UsageDay[] };
        setUsage(data.daily ?? []);
      }
    } catch {
      // silent
    } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => { void fetchCredits(); void fetchUsage(); }, [fetchCredits, fetchUsage]);

  const totalTokens = usage.reduce((acc, u) => acc + u.input_tokens + u.output_tokens, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-6 space-y-6">

        {/* Credit Balance */}
        <div className="rounded-md border border-border bg-panel p-5">
          <div className="mb-4 flex items-center gap-2">
            <Icon name="wallet" size={14} />
            <h2 className="text-sm font-semibold text-foreground">Credits</h2>
          </div>
          {creditsLoading ? (
            <div className="flex items-center gap-2"><Spinner size="sm" /> <span className="text-xs text-muted-foreground">Loading...</span></div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-md bg-panel-raised p-4">
                <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Balance</div>
                <div className="mt-1 text-2xl font-semibold text-foreground">{credits?.balance ?? 0}</div>
                <div className="text-2xs text-muted-foreground">credits available</div>
              </div>
              <div className="rounded-md bg-panel-raised p-4">
                <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Lifetime Used</div>
                <div className="mt-1 text-2xl font-semibold text-foreground">{credits?.lifetimeUsed ?? 0}</div>
                <div className="text-2xs text-muted-foreground">credits consumed</div>
              </div>
            </div>
          )}
          <div className="mt-4">
            <Notice tone="info">
              Credits are consumed when AI models process your requests. Connect a payment provider in Settings &gt; Connections to purchase credits.
            </Notice>
          </div>
        </div>

        {/* Usage Summary */}
        <div className="rounded-md border border-border bg-panel p-5">
          <div className="mb-4 flex items-center gap-2">
            <Icon name="chart" size={14} />
            <h2 className="text-sm font-semibold text-foreground">Usage (30 days)</h2>
          </div>
          {usageLoading ? (
            <div className="flex items-center gap-2"><Spinner size="sm" /> <span className="text-xs text-muted-foreground">Loading...</span></div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-md bg-panel-raised p-3">
                  <div className="text-2xs text-muted-foreground">Total Tokens</div>
                  <div className="text-lg font-semibold text-foreground">{totalTokens.toLocaleString()}</div>
                </div>
                <div className="rounded-md bg-panel-raised p-3">
                  <div className="text-2xs text-muted-foreground">Input Tokens</div>
                  <div className="text-lg font-semibold text-foreground">{usage.reduce((a, u) => a + u.input_tokens, 0).toLocaleString()}</div>
                </div>
                <div className="rounded-md bg-panel-raised p-3">
                  <div className="text-2xs text-muted-foreground">Output Tokens</div>
                  <div className="text-lg font-semibold text-foreground">{usage.reduce((a, u) => a + u.output_tokens, 0).toLocaleString()}</div>
                </div>
              </div>
              {usage.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="pb-2 font-medium">Day</th>
                        <th className="pb-2 font-medium">Model</th>
                        <th className="pb-2 font-medium text-end">Input</th>
                        <th className="pb-2 font-medium text-end">Output</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.slice(0, 14).map((u, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="py-1.5 text-muted-foreground">{new Date(u.day).toLocaleDateString()}</td>
                          <td className="py-1.5"><Pill className="text-3xs">{u.model}</Pill></td>
                          <td className="py-1.5 text-end tabular-nums">{u.input_tokens.toLocaleString()}</td>
                          <td className="py-1.5 text-end tabular-nums">{u.output_tokens.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {usage.length === 0 && (
                <p className="mt-4 text-xs text-muted-foreground">No usage recorded yet.</p>
              )}
            </>
          )}
        </div>

        {/* Plans */}
        <div className="rounded-md border border-border bg-panel p-5">
          <div className="mb-4 flex items-center gap-2">
            <Icon name="tag" size={14} />
            <h2 className="text-sm font-semibold text-foreground">Plans</h2>
          </div>
          <Notice tone="warning">
            Subscription plans are not yet available. Connect a payment provider to enable plan management.
          </Notice>
        </div>

      </div>
    </div>
  );
}
