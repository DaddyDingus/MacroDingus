import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

// Authorization Code + PKCE against an OIDC provider (Authentik here, but
// nothing below is Authentik-specific). Local password login stays available
// alongside this as break-glass for when the provider is unreachable — losing
// access to your own food diary because an identity server is down is a worse
// failure than the one this is protecting against.

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  requiredGroup: string | null;
  providerName: string;
}

export function loadOidcConfig(): OidcConfig | null {
  const issuer = process.env.MACRODINGUS_OIDC_ISSUER?.trim();
  const clientId = process.env.MACRODINGUS_OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.MACRODINGUS_OIDC_CLIENT_SECRET?.trim();
  const redirectUri = process.env.MACRODINGUS_OIDC_REDIRECT_URI?.trim();

  // All four or nothing. A half-configured provider that silently degrades to
  // password-only is worse than one that is plainly off, because you would
  // believe SSO was protecting the app when it was not.
  if (!issuer || !clientId || !clientSecret || !redirectUri) return null;

  return {
    issuer: issuer.replace(/\/$/, ""),
    clientId,
    clientSecret,
    redirectUri,
    requiredGroup: process.env.MACRODINGUS_OIDC_REQUIRED_GROUP?.trim() || null,
    providerName: process.env.MACRODINGUS_OIDC_PROVIDER_NAME?.trim() || "SSO",
  };
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

let discoveryCache: { at: number; value: Discovery } | null = null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

async function discover(config: OidcConfig): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS) return discoveryCache.value;

  const url = `${config.issuer}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`);
  const value = (await res.json()) as Discovery;

  for (const field of ["authorization_endpoint", "token_endpoint", "jwks_uri", "issuer"] as const) {
    if (typeof value[field] !== "string" || !value[field]) throw new Error(`OIDC discovery missing ${field}`);
  }

  discoveryCache = { at: Date.now(), value };
  return value;
}

let jwksCache: { uri: string; jwks: ReturnType<typeof createRemoteJWKSet> } | null = null;

function jwksFor(uri: string) {
  // createRemoteJWKSet does its own key caching and rotation handling, so the
  // one thing to avoid is building a fresh instance per request — that would
  // refetch the key set on every single login.
  if (!jwksCache || jwksCache.uri !== uri) {
    jwksCache = { uri, jwks: createRemoteJWKSet(new URL(uri)) };
  }
  return jwksCache.jwks;
}

export function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface AuthRequestState {
  state: string;
  codeVerifier: string;
  nonce: string;
}

export function createAuthRequestState(): AuthRequestState {
  return {
    state: base64url(crypto.randomBytes(32)),
    codeVerifier: base64url(crypto.randomBytes(32)),
    nonce: base64url(crypto.randomBytes(16)),
  };
}

export async function authorizationUrl(config: OidcConfig, request: AuthRequestState): Promise<string> {
  const { authorization_endpoint } = await discover(config);
  const challenge = base64url(crypto.createHash("sha256").update(request.codeVerifier).digest());

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    // `groups` is what Authentik maps its group membership into. A provider
    // that doesn't know the scope simply omits it from the granted set.
    scope: "openid profile email groups",
    state: request.state,
    nonce: request.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return `${authorization_endpoint}?${params.toString()}`;
}

export interface OidcIdentity {
  subject: string;
  username: string;
  email: string | null;
  groups: string[];
}

function claimToStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return value.split(/[\s,]+/).filter(Boolean);
  return [];
}

export async function exchangeCode(
  config: OidcConfig,
  code: string,
  request: AuthRequestState
): Promise<OidcIdentity> {
  const discovery = await discover(config);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: request.codeVerifier,
  });

  const res = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);

  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("Provider returned no id_token");

  // Verify the signature against the provider's published keys and pin both
  // issuer and audience. Skipping this would mean trusting whatever came back
  // over the wire, which is the difference between SSO and a suggestion.
  const { payload } = await jwtVerify(tokens.id_token, jwksFor(discovery.jwks_uri), {
    issuer: discovery.issuer,
    audience: config.clientId,
  });

  // Binds this token to the authorization request that started the flow, so a
  // token obtained elsewhere cannot be replayed into this session.
  if (payload.nonce !== request.nonce) throw new Error("Nonce mismatch");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("Token has no subject");

  const claims = payload as JWTPayload & {
    preferred_username?: unknown;
    name?: unknown;
    email?: unknown;
    groups?: unknown;
  };

  const username =
    (typeof claims.preferred_username === "string" && claims.preferred_username.trim()) ||
    (typeof claims.name === "string" && claims.name.trim()) ||
    (typeof claims.email === "string" && claims.email.split("@")[0]) ||
    payload.sub;

  return {
    subject: payload.sub,
    username: String(username).slice(0, 40),
    email: typeof claims.email === "string" ? claims.email : null,
    groups: claimToStringArray(claims.groups),
  };
}

export function isAuthorized(config: OidcConfig, identity: OidcIdentity): boolean {
  if (!config.requiredGroup) return true;
  return identity.groups.includes(config.requiredGroup);
}
