/**
 * Payment provider interface.
 *
 * This is the provider-agnostic abstraction for billing.
 * Implementations live in lib/billing/providers/{id}.ts.
 * Provider config is loaded from supabase/seed/billing-providers.json.
 *
 * Adding a new provider:
 * 1. Add an entry to supabase/seed/billing-providers.json
 * 2. Create lib/billing/providers/{id}.ts implementing this interface
 * 3. Enable the provider in the admin UI
 */

export interface PaymentProvider {
  /** Unique provider identifier (e.g., "stripe", "zarinpal") */
  id: string;

  /** Human-readable name */
  name: string;

  /**
   * Create a customer record in the payment provider.
   * @returns Provider-specific customer ID
   */
  createCustomer(params: {
    orgId: string;
    orgName: string;
    email: string;
  }): Promise<string>;

  /**
   * Create a checkout session for subscription or one-time payment.
   * @returns Checkout URL to redirect the user to
   */
  createCheckout(params: {
    customerId: string;
    planId: string;
    orgId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string>;

  /**
   * Create a customer portal session for managing subscription.
   * @returns Portal URL to redirect the user to
   */
  createPortal(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<string>;

  /**
   * Handle a webhook event from the payment provider.
   * @param payload Raw webhook payload
   * @param signature Provider-specific signature for verification
   * @returns Normalized billing event, or null if unhandled
   */
  handleWebhook(
    payload: unknown,
    signature: string | null
  ): Promise<BillingEvent | null>;
}

/**
 * Normalized billing event from any provider.
 * This is what gets stored in the billing_events table.
 */
export interface BillingEvent {
  orgId: string;
  type:
    | "subscription.created"
    | "subscription.updated"
    | "subscription.deleted"
    | "payment.succeeded"
    | "payment.failed"
    | "credits.purchased";
  customerId: string;
  subscriptionId?: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Plan definition for display and checkout.
 */
export interface BillingPlan {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  credits: number;
  features: string[];
}

/**
 * Provider configuration from seed file.
 */
export interface ProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}
