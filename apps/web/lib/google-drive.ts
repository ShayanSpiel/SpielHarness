import { listConnections, updateConnection } from "@spielos/db";
import { decryptConnectionSecret, encryptConnectionSecret } from "./connection-secrets";
import { getOrg } from "./server";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const EXPIRY_MARGIN_MS = 60_000;

type StoredGoogleCredential = {
  provider?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
};

export type GoogleDriveAccess = {
  accessToken: string;
  account: string | null;
  connectionId: string;
};

export async function resolveGoogleDriveAccess(): Promise<GoogleDriveAccess | null> {
  const org = await getOrg();
  const connections = await listConnections(org.sql, org.orgId);
  const connection = connections.find(
    (candidate) => candidate.config?.presetId === "google-drive" && candidate.enabled !== false
  );
  if (!connection) return null;

  const config = connection.config ?? {};
  const encrypted = config.oauthCredential;
  if (typeof encrypted !== "string" || encrypted.length === 0) return null;

  let credential: StoredGoogleCredential;
  try {
    credential = decryptConnectionSecret(encrypted) as StoredGoogleCredential;
  } catch {
    return null;
  }

  const account = typeof config.account === "string" ? config.account : null;
  const expiresAt = Number(credential.expiresAt);
  const accessIsCurrent =
    typeof credential.accessToken === "string" &&
    credential.accessToken.length > 0 &&
    (!Number.isFinite(expiresAt) || expiresAt > Date.now() + EXPIRY_MARGIN_MS);

  if (accessIsCurrent) {
    return { accessToken: credential.accessToken!, account, connectionId: connection.id };
  }

  if (!credential.refreshToken || !CLIENT_ID || !CLIENT_SECRET) return null;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: credential.refreshToken,
      grant_type: "refresh_token"
    }),
    cache: "no-store"
  });
  if (!tokenResponse.ok) return null;

  const token = await tokenResponse.json() as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
  };
  if (!token.access_token) return null;

  const nextCredential: StoredGoogleCredential = {
    ...credential,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? credential.refreshToken,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    scope: token.scope ?? credential.scope
  };
  await updateConnection(org.sql, org.orgId, connection.id, {
    status: "configured",
    config: {
      ...config,
      oauthCredential: encryptConnectionSecret(nextCredential)
    }
  });

  return { accessToken: token.access_token, account, connectionId: connection.id };
}
