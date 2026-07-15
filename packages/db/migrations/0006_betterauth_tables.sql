-- BetterAuth tables (standard PostgreSQL, no vendor lock-in).
-- Uses quoted camelCase column names to match BetterAuth's Kysely schema.

DROP TABLE IF EXISTS verification CASCADE;
DROP TABLE IF EXISTS account CASCADE;
DROP TABLE IF EXISTS session CASCADE;
DROP TABLE IF EXISTS "user" CASCADE;

CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "name" TEXT,
  "email" TEXT NOT NULL,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  "image" TEXT,
  "displayName" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX user_email_idx ON "user" ("email");

CREATE TABLE session (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX session_token_idx ON session ("token");
CREATE INDEX session_user_idx ON session ("userId");

CREATE TABLE account (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX account_provider_idx ON account ("providerId", "accountId");
CREATE INDEX account_user_idx ON account ("userId");

CREATE TABLE verification (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX verification_identifier_idx ON verification ("identifier");
