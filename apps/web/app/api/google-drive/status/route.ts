import { listConnections } from "@spielos/db";
import { getOrg } from "../../../../lib/server";

export async function GET() {
  try {
    const org = await getOrg();
    const connections = await listConnections(org.sql, org.orgId);
    const driveConnection = connections.find(
      (c) => c.config?.presetId === "google-drive" && c.enabled !== false
    );

    if (!driveConnection) {
      return Response.json({ connected: false });
    }

    const config = (driveConnection.config ?? {}) as Record<string, unknown>;
    const hasCredential = typeof config.oauthCredential === "string" && config.oauthCredential.length > 0;
    const account = typeof config.account === "string" ? config.account : null;

    return Response.json({
      connected: hasCredential,
      account,
      connectionId: driveConnection.id
    });
  } catch {
    return Response.json({ connected: false });
  }
}
