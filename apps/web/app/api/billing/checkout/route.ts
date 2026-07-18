import { getOrg, errorResponse } from "../../../../lib/server";

export async function POST(request: Request) {
  try {
    await getOrg();
    await request.json();

    // TODO: Implement when a payment provider is configured
    // This will:
    // 1. Look up or create a billing account for the org
    // 2. Create a checkout session with the provider
    // 3. Return the checkout URL

    return Response.json({
      error: "Billing is not yet configured. Connect a payment provider in Settings > Connections.",
      checkoutUrl: null
    }, { status: 501 });
  } catch (err) {
    return errorResponse(err);
  }
}
