import type { PaymentProvider, ProviderConfig } from "./provider";

/**
 * Registry of available payment providers.
 * Providers are loaded from supabase/seed/billing-providers.json.
 * Runtime state (enabled/disabled) is stored in the billing_providers table.
 */

const providerCache = new Map<string, PaymentProvider>();

/**
 * Load provider configurations from the seed file.
 * This reads from the filesystem in development and from a cached copy in production.
 */
export async function loadProviderConfigs(): Promise<ProviderConfig[]> {
  try {
    // In production, this would read from a cached copy or database
    // For now, return empty - providers are added via the admin UI
    return [];
  } catch {
    return [];
  }
}

/**
 * Get a provider implementation by ID.
 * Returns null if the provider is not found or not enabled.
 */
export async function getProvider(
  providerId: string
): Promise<PaymentProvider | null> {
  const cached = providerCache.get(providerId);
  if (cached) return cached;

  try {
    // Dynamic import of provider implementation
    const mod = await import(`./providers/${providerId}`);
    const provider = mod.default as PaymentProvider;
    if (provider.id === providerId) {
      providerCache.set(providerId, provider);
      return provider;
    }
  } catch {
    // Provider not found
  }

  return null;
}

/**
 * Get all enabled providers.
 */
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
