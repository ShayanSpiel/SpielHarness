import type { PaymentProvider } from "../provider";

/**
 * Zarinpal payment provider skeleton (Iranian payment gateway).
 * TODO: Implement when ZARINPAL_MERCHANT_ID is configured.
 */
export const zarinpalProvider: PaymentProvider = {
  id: "zarinpal",
  name: "Zarinpal",

  async createCustomer({ email }) {
    return email;
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createCheckout({ customerId, planId, orgId, successUrl, cancelUrl }) {
    throw new Error("Zarinpal provider not yet configured. Set ZARINPAL_MERCHANT_ID to enable.");
  },

  async createPortal({ returnUrl }) {
    return returnUrl;
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async handleWebhook(payload, signature) {
    return null;
  }
};
