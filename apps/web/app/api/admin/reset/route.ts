import { resetWorkspace } from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireAdmin } from "../../../../lib/server";

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireAdmin(org);
    const body = (await request.json().catch(() => ({}))) as { mode?: "files" | "all"; confirm?: string };
    const mode = (body.mode ?? "files") as "files" | "all";
    if (body.confirm !== "RESET") {
      throw new HttpError(400, 'Pass { confirm: "RESET" } to confirm.');
    }
    await resetWorkspace(org.sql, org.orgId, mode);
    return Response.json({ ok: true, mode });
  } catch (err) {
    return errorResponse(err);
  }
}
