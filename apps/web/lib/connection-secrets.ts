import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const source = process.env.CONNECTION_ENCRYPTION_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!source) throw new Error("CONNECTION_ENCRYPTION_KEY is required for OAuth connections.");
  return createHash("sha256").update(source).digest();
}

export function encryptConnectionSecret(value: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptConnectionSecret(value: string): Record<string, unknown> {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Invalid encrypted connection credential.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8")) as Record<string, unknown>;
}
