import { getOrg, errorResponse } from "../../../../lib/server";

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    if (!org.userId) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json();
    const { provider, event } = body;

    if (!provider || !event) {
      return Response.json({ error: "provider and event are required" }, { status: 400 });
    }

    // Store the billing event
    await org.sql`
      INSERT INTO billing_events (org_id, provider, provider_event_id, event_type, payload)
      VALUES (
        ${org.orgId},
        ${provider},
        ${event.id || "manual"},
        ${event.type || "unknown"},
        ${JSON.stringify(event)}
      )
      ON CONFLICT (provider, provider_event_id) DO NOTHING
    `;

    return Response.json({ received: true });
  } catch (err) {
    return errorResponse(err);
  }
}
