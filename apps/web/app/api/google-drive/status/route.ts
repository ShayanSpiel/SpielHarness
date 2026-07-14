import { resolveGoogleDriveAccess } from "../../../../lib/google-drive";

export async function GET() {
  try {
    const access = await resolveGoogleDriveAccess();
    if (!access) return Response.json({ connected: false });

    return Response.json({
      connected: true,
      account: access.account,
      connectionId: access.connectionId
    });
  } catch {
    return Response.json({ connected: false });
  }
}
