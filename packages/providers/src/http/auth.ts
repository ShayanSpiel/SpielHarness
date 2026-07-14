import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type StoredOAuthCredential = {
  provider?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  [key: string]: unknown;
};

function getKey(): Buffer {
  const source =
    process.env.CONNECTION_ENCRYPTION_KEY ||
    (process.env.NODE_ENV !== "production"
      ? process.env.DATABASE_URL || "spielos-dev-fallback"
      : "");
  if (!source)
    throw new Error("CONNECTION_ENCRYPTION_KEY is required in production.");
  return createHash("sha256").update(source).digest();
}

export function encryptConnectionSecret(
  value: Record<string, unknown>
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptConnectionSecret(value: string): Record<string, unknown> {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted)
    throw new Error("Invalid encrypted connection credential.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8")
  ) as Record<string, unknown>;
}

const EXPIRY_MARGIN_MS = 60_000;

export async function resolveGoogleAccessToken(
  connectionId: string,
  config: Record<string, unknown>
): Promise<string> {
  const encrypted = config.oauthCredential;
  if (typeof encrypted !== "string" || encrypted.length === 0) {
    throw new Error(`Connection "${connectionId}" has no OAuth credential.`);
  }

  let credential: StoredOAuthCredential;
  try {
    credential = decryptConnectionSecret(encrypted) as StoredOAuthCredential;
  } catch {
    throw new Error(
      `Connection "${connectionId}" has a corrupted OAuth credential.`
    );
  }

  if (!credential.accessToken) {
    throw new Error(
      `Connection "${connectionId}" is missing an access token. Reconnect the account.`
    );
  }

  const expiresAt = Number(credential.expiresAt);
  const isExpired =
    Number.isFinite(expiresAt) && expiresAt <= Date.now() + EXPIRY_MARGIN_MS;

  if (!isExpired) return credential.accessToken;

  if (!credential.refreshToken) {
    throw new Error(
      `Connection "${connectionId}" has no refresh token. Reconnect with offline access.`
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: credential.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  if (!tokenResponse.ok) {
    throw new Error(
      `Connection "${connectionId}" token refresh failed with HTTP ${tokenResponse.status}.`
    );
  }

  const token = await tokenResponse.json() as {
    access_token?: string;
    expires_in?: number;
  };

  if (!token.access_token) {
    throw new Error(
      `Connection "${connectionId}" token refresh returned no access token.`
    );
  }

  return token.access_token;
}
