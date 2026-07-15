import { getOrg, errorResponse } from "../../../../lib/server";
import { ensureOrgCredits } from "@spielos/db";

export async function GET() {
  try {
    const org = await getOrg();
    if (!org.userId) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const credits = await ensureOrgCredits(org.sql, org.orgId);
    return Response.json({
      balance: credits.balance,
      lifetimeUsed: credits.lifetime_used,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
