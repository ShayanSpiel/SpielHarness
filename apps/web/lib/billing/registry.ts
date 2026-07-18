import type { PaymentProvider, ProviderConfig } from "./provider";

const providerCache = new Map<string, PaymentProvider>();

const PROVIDER_MAP: Record<string, () => Promise<{ default: PaymentProvider } | { stripeProvider: PaymentProvider } | { zarinpalProvider: PaymentProvider }>> = {
  stripe: () => import("./providers/stripe"),
  zarinpal: () => import("./providers/zarinpal"),
};

export async function loadProviderConfigs(): Promise<ProviderConfig[]> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/harness/seed`, {
      method: "GET",
      cache: "no-store"
    });
    if (!res.ok) return [];
    const data = await res.json() as { billingProviders?: ProviderConfig[] };
    return data.billingProviders ?? [];
  } catch {
    return [
      { id: "stripe", name: "Stripe", enabled: false, config: {} },
      { id: "zarinpal", name: "Zarinpal", enabled: false, config: {} }
    ];
  }
}

export async function getProvider(providerId: string): Promise<PaymentProvider | null> {
  const cached = providerCache.get(providerId);
  if (cached) return cached;

  const loader = PROVIDER_MAP[providerId];
  if (!loader) return null;

  try {
    const mod = await loader();
    const provider = ("stripeProvider" in mod ? mod.stripeProvider : "zarinpalProvider" in mod ? mod.zarinpalProvider : mod.default) as PaymentProvider;
    if (provider?.id === providerId) {
      providerCache.set(providerId, provider);
      return provider;
    }
  } catch {
    // Provider not available
  }

  return null;
}

export async function getEnabledProviders(): Promise<PaymentProvider[]> {
  const configs = await loadProviderConfigs();
  const enabled = configs.filter((c) => c.enabled);
  const providers: PaymentProvider[] = [];
  for (const config of enabled) {
    const provider = await getProvider(config.id);
    if (provider) providers.push(provider);
  }
  return providers;
}
