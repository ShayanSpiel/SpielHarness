import { getOrg, errorResponse } from "../../../../lib/server";

export async function GET() {
  try {
    const org = await getOrg();
    const plans = await org.sql`
      SELECT id, name, price_cents, interval, credits_included, features, enabled
      FROM plans
      WHERE enabled = true
      ORDER BY price_cents ASC
    `;
    return Response.json({ plans });
  } catch (err) {
    return errorResponse(err);
  }
}
