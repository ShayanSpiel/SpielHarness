import type { PaymentProvider } from "../provider";

/**
 * Stripe payment provider skeleton.
 * TODO: Implement when STRIPE_SECRET_KEY is configured.
 */
export const stripeProvider: PaymentProvider = {
  id: "stripe",
  name: "Stripe",

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createCustomer({ orgId, orgName, email }) {
    throw new Error("Stripe provider not yet configured. Set STRIPE_SECRET_KEY to enable.");
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createCheckout({ customerId, planId, orgId, successUrl, cancelUrl }) {
    throw new Error("Stripe provider not yet configured.");
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createPortal({ customerId, returnUrl }) {
    throw new Error("Stripe provider not yet configured.");
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async handleWebhook(payload, signature) {
    return null;
  }
};
