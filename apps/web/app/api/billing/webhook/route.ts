import { createOrgSql } from "@spielos/db";
import { getSql } from "../../../../lib/server";

export async function POST(request: Request) {
  try {
    const sql = getSql();
    if (!sql) {
      return Response.json({ error: "Database not configured" }, { status: 500 });
    }

    const body = await request.json();
    const { provider, event, org_id } = body;

    if (!provider || !event || !org_id) {
      return Response.json({ error: "provider, event, and org_id are required" }, { status: 400 });
    }

    const ctx = createOrgSql(sql, org_id);

    await ctx.sql`
      INSERT INTO billing_events (org_id, provider, provider_event_id, event_type, payload)
      VALUES (
        ${ctx.orgId},
        ${provider},
        ${event.id || "manual"},
        ${event.type || "unknown"},
        ${JSON.stringify(event)}
      )
      ON CONFLICT (provider, provider_event_id) DO NOTHING
    `;

    return Response.json({ received: true });
  } catch (err) {
    console.error("[billing/webhook]", err);
    return Response.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
