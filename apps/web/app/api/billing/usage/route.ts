import { getOrg, errorResponse } from "../../../../lib/server";

export async function GET() {
  try {
    const org = await getOrg();
    const usage = await org.sql`
      SELECT
        date_trunc('day', created_at) AS day,
        provider,
        model,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cost_micros) AS cost_micros
      FROM usage_ledger
      WHERE org_id = ${org.orgId}
        AND created_at > now() - interval '30 days'
      GROUP BY 1, 2, 3
      ORDER BY 1 DESC
    `;
    const totals = await org.sql`
      SELECT
        SUM(input_tokens) AS total_input_tokens,
        SUM(output_tokens) AS total_output_tokens,
        SUM(cost_micros) AS total_cost_micros
      FROM usage_ledger
      WHERE org_id = ${org.orgId}
        AND created_at > now() - interval '30 days'
    `;
    return Response.json({
      daily: usage,
      totals: totals[0] ?? { total_input_tokens: 0, total_output_tokens: 0, total_cost_micros: 0 }
    });
  } catch (err) {
    return errorResponse(err);
  }
}
