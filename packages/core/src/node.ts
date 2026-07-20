import { createHash } from "node:crypto";

/**
 * Deterministic UUID v5–style from an arbitrary string.
 * Uses SHA-256 (not UUID-name-based SHA-1). Returns an 8-4-4-4-12 hex string.
 * Server-only; uses `node:crypto`.
 */
export function stableUuid(value: string): string {
  const chars = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
