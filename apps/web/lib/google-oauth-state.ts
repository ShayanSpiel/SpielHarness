import { createHmac, timingSafeEqual } from "node:crypto";

export type GoogleOAuthContext = {
  state: string;
  integration: string;
  orgId: string;
  userId: string;
  expiresAt: number;
};

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function hasExpectedShape(value: unknown): value is GoogleOAuthContext {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GoogleOAuthContext>;
  return typeof candidate.state === "string"
    && typeof candidate.integration === "string"
    && typeof candidate.orgId === "string"
    && typeof candidate.userId === "string"
    && Number.isFinite(candidate.expiresAt);
}

/** Creates a signed, short-lived OAuth context cookie for one user and workspace. */
export function createGoogleOAuthContext(context: GoogleOAuthContext, secret: string): string {
  if (!secret) throw new Error("Google OAuth state signing is not configured.");
  const payload = encode(JSON.stringify(context));
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns null for malformed, tampered, or expired OAuth state. */
export function verifyGoogleOAuthContext(value: string | undefined, secret: string, now = Date.now()): GoogleOAuthContext | null {
  if (!value || !secret) return null;
  const [payload, providedSignature, ...rest] = value.split(".");
  if (!payload || !providedSignature || rest.length > 0) return null;

  const expectedSignature = sign(payload, secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!hasExpectedShape(parsed) || parsed.expiresAt <= now) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function googleOAuthStateSigningSecret(): string {
  return process.env.BETTER_AUTH_SECRET?.trim()
    || process.env.CONNECTION_ENCRYPTION_KEY?.trim()
    || "";
}
