import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleOAuthContext, verifyGoogleOAuthContext } from "../apps/web/lib/google-oauth-state.ts";

const secret = "test-signing-secret";
const context = {
  state: "nonce-1",
  integration: "google-drive",
  orgId: "org-1",
  userId: "user-1",
  expiresAt: 20_000
};

test("Google OAuth context round-trips only when signed and unexpired", () => {
  const value = createGoogleOAuthContext(context, secret);
  assert.deepEqual(verifyGoogleOAuthContext(value, secret, 10_000), context);
});

test("Google OAuth context rejects a tampered payload or signature", () => {
  const value = createGoogleOAuthContext(context, secret);
  const [payload, signature] = value.split(".");
  assert.equal(verifyGoogleOAuthContext(`${payload}x.${signature}`, secret, 10_000), null);
  assert.equal(verifyGoogleOAuthContext(`${payload}.${signature}x`, secret, 10_000), null);
});

test("Google OAuth context rejects expired state", () => {
  const value = createGoogleOAuthContext(context, secret);
  assert.equal(verifyGoogleOAuthContext(value, secret, 20_000), null);
});
