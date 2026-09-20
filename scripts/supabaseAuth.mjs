import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

const asymmetricAlgorithms = ["ES256", "RS256"];

export class AuthenticationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthenticationError";
    this.code = code;
  }
}

export function readAuthConfig(env = process.env, databaseProvider = "sqlite") {
  const explicitMode = env.AUTH_MODE?.trim().toLowerCase();
  const mode = explicitMode || (databaseProvider === "postgres" ? "supabase" : "disabled");

  if (!['disabled', 'supabase'].includes(mode)) {
    throw new Error("AUTH_MODE must be disabled or supabase.");
  }

  if (mode === "disabled") {
    if (databaseProvider === "postgres") {
      throw new Error("AUTH_MODE=disabled is not allowed with Supabase Postgres persistence.");
    }
    return { mode };
  }

  const supabaseUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required when AUTH_MODE=supabase.");
  }
  if (!publishableKey) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY is required when AUTH_MODE=supabase.");
  }

  return {
    mode,
    supabaseUrl,
    publishableKey,
    issuer: `${supabaseUrl}/auth/v1`,
    jwksUrl: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
  };
}

export function createRequestAuthenticator(config, dependencies = {}) {
  if (config.mode === "disabled") {
    return async function authenticateLocalRequest() {
      return { id: "local-development", email: null, role: "authenticated" };
    };
  }

  const verifyToken = dependencies.verifyToken ?? createSupabaseTokenVerifier(config, dependencies);
  return async function authenticateRequest(request) {
    const token = readBearerToken(request.headers.authorization);
    return verifyToken(token);
  };
}

export function createSupabaseTokenVerifier(config, dependencies = {}) {
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const jwks = dependencies.jwks ?? createRemoteJWKSet(new URL(config.jwksUrl));

  return async function verifySupabaseToken(token) {
    let header;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw new AuthenticationError("INVALID_ACCESS_TOKEN", "The access token is malformed.");
    }

    if (header.alg === "HS256") {
      return verifyLegacyToken(config, token, fetchImplementation);
    }
    if (!asymmetricAlgorithms.includes(header.alg)) {
      throw new AuthenticationError("INVALID_ACCESS_TOKEN", "The access token uses an unsupported signing algorithm.");
    }

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: "authenticated",
        algorithms: asymmetricAlgorithms,
      });
      return identityFromClaims(payload);
    } catch {
      throw new AuthenticationError("INVALID_ACCESS_TOKEN", "The access token is invalid or expired.");
    }
  };
}

export function readBearerToken(authorization) {
  if (typeof authorization !== "string" || authorization.trim() === "") {
    throw new AuthenticationError("AUTHENTICATION_REQUIRED", "Sign in is required.");
  }

  const match = authorization.match(/^Bearer ([^\s]+)$/i);
  if (!match) {
    throw new AuthenticationError("INVALID_AUTHORIZATION_HEADER", "Use an Authorization header with a Bearer token.");
  }
  return match[1];
}

export function createBrowserAuthConfig(config) {
  return config.mode === "supabase"
    ? { required: true, supabaseUrl: config.supabaseUrl, publishableKey: config.publishableKey }
    : { required: false };
}

async function verifyLegacyToken(config, token, fetchImplementation) {
  let response;
  try {
    response = await fetchImplementation(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.publishableKey,
        authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new AuthenticationError("AUTH_SERVICE_UNAVAILABLE", "The authentication service is unavailable.");
  }

  if (!response.ok) {
    throw new AuthenticationError("INVALID_ACCESS_TOKEN", "The access token is invalid or expired.");
  }
  const user = await response.json();
  if (!user || typeof user.id !== "string" || user.id === "") {
    throw new AuthenticationError("INVALID_ACCESS_TOKEN", "The authentication service returned an invalid user.");
  }
  return { id: user.id, email: typeof user.email === "string" ? user.email : null, role: "authenticated" };
}

function identityFromClaims(payload) {
  if (typeof payload.sub !== "string" || payload.sub === "" || payload.role !== "authenticated") {
    throw new AuthenticationError("INVALID_ACCESS_TOKEN", "The access token does not identify an authenticated user.");
  }
  return {
    id: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    role: "authenticated",
  };
}

function normalizeSupabaseUrl(value) {
  if (!value?.trim()) return undefined;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("SUPABASE_URL must be a valid URL.");
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("SUPABASE_URL must be an HTTP(S) project URL without credentials, query, or fragment.");
  }
  return url.toString().replace(/\/$/, "");
}
