import assert from "node:assert/strict";
import test from "node:test";

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import {
  AuthenticationError,
  createBrowserAuthConfig,
  createRequestAuthenticator,
  createSupabaseTokenVerifier,
  readAuthConfig,
  readBearerToken,
} from "../scripts/supabaseAuth.mjs";

const projectUrl = "https://project-ref.supabase.co";
const publishableKey = "sb_publishable_test_key";

test("authentication configuration always requires Supabase Auth", () => {
  assert.throws(() => readAuthConfig({}), /SUPABASE_URL is required/);
  assert.throws(
    () => readAuthConfig({ AUTH_MODE: "disabled" }),
    /Disabled authentication is no longer supported/,
  );

  const config = readAuthConfig({
    AUTH_MODE: "supabase",
    SUPABASE_URL: `${projectUrl}/`,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
  });
  assert.deepEqual(config, {
    mode: "supabase",
    supabaseUrl: projectUrl,
    publishableKey,
    issuer: `${projectUrl}/auth/v1`,
    jwksUrl: `${projectUrl}/auth/v1/.well-known/jwks.json`,
  });
  assert.deepEqual(createBrowserAuthConfig(config), {
    required: true,
    supabaseUrl: projectUrl,
    publishableKey,
  });
});

test("Bearer authentication rejects missing and malformed headers", async () => {
  assert.throws(() => readBearerToken(undefined), AuthenticationError);
  assert.throws(() => readBearerToken("Basic abc"), /Bearer token/);
  assert.equal(readBearerToken("Bearer token-value"), "token-value");

  const authenticate = createRequestAuthenticator(validConfig(), {
    verifyToken: async (token) => ({ id: token, email: null, role: "authenticated" }),
  });
  assert.deepEqual(await authenticate({ headers: { authorization: "Bearer user-1" } }), {
    id: "user-1", email: null, role: "authenticated",
  });
  await assert.rejects(() => authenticate({ headers: {} }), /Sign in is required/);
});

test("asymmetric Supabase JWT verification accepts valid users and rejects expired tokens", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: "test-key", alg: "ES256", use: "sig" });
  const verifier = createSupabaseTokenVerifier(validConfig(), {
    jwks: createLocalJWKSet({ keys: [jwk] }),
  });
  const validToken = await signToken(privateKey, Math.floor(Date.now() / 1000) + 300);

  assert.deepEqual(await verifier(validToken), {
    id: "user-1",
    email: "user@example.com",
    role: "authenticated",
  });
  await assert.rejects(
    async () => verifier(await signToken(privateKey, Math.floor(Date.now() / 1000) - 1)),
    /invalid or expired/,
  );
  await assert.rejects(() => verifier("not-a-jwt"), /malformed/);
});

test("legacy HS256 tokens are validated by the Supabase Auth user endpoint", async () => {
  const token = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("legacy-user")
    .sign(new TextEncoder().encode("a-test-secret-that-is-long-enough"));
  const requests = [];
  const verifier = createSupabaseTokenVerifier(validConfig(), {
    fetch: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ id: "legacy-user", email: "legacy@example.com" }), { status: 200 });
    },
    jwks: async () => {
      throw new Error("JWKS must not be used for a legacy token.");
    },
  });

  assert.deepEqual(await verifier(token), {
    id: "legacy-user", email: "legacy@example.com", role: "authenticated",
  });
  assert.equal(requests[0].url, `${projectUrl}/auth/v1/user`);
  assert.equal(requests[0].init.headers.apikey, publishableKey);
});

function validConfig() {
  return readAuthConfig({
    SUPABASE_URL: projectUrl,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
  });
}

async function signToken(privateKey, expiresAt) {
  return new SignJWT({ role: "authenticated", email: "user@example.com" })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setSubject("user-1")
    .setIssuer(`${projectUrl}/auth/v1`)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(privateKey);
}
