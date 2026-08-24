import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Issuer, generators, type Client } from "openid-client";
import { z } from "zod";
import { eq, lt } from "drizzle-orm";
import { db, sqlite } from "./db/index.js";
import { appSessions, users } from "./db/schema.js";
import { createRemoteBackchannelLogoutVerifier, type BackchannelLogoutClaims } from "./backchannelLogout.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

const COOKIE_NAME = "mt_session";
const OIDC_COOKIE_NAME = "mt_oidc";
const SESSION_MS = 365 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const OIDC_ISSUER = process.env.OIDC_ISSUER?.trim() ?? "";
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID?.trim() || "macrodaddy";
const OIDC_REDIRECT_ORIGINS = new Set((process.env.OIDC_REDIRECT_ORIGINS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean));
const OIDC_BOOTSTRAP_USERNAME = process.env.OIDC_BOOTSTRAP_USERNAME?.trim().toLowerCase() ?? "";
const OIDC_BOOTSTRAP_ACCOUNT = process.env.OIDC_BOOTSTRAP_ACCOUNT?.trim().toLowerCase() ?? "";
const secureCookies = process.env.NODE_ENV === "production";
// users.lastSeenAt only has to be accurate enough to answer "is anyone still
// opening this account?", so it is written at most once an hour rather than on
// every authenticated request.
const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000;
let oidcIssuerPromise: ReturnType<typeof Issuer.discover> | null = null;
let oidcClientPromise: Promise<Client> | null = null;
let backchannelVerifierPromise: Promise<(token: string) => Promise<BackchannelLogoutClaims>> | null = null;

// Distinguished from a generic sign-in failure so the callback can say what
// actually happened. A blocked person retrying forever because the app told
// them "sign-in failed" is the same outage as being locked out by accident.
class AccountBlockedError extends Error {}

function publicUser(user: Pick<typeof users.$inferSelect, "id" | "name" | "role">) {
  return { id: user.id, name: user.name, role: user.role === "admin" ? "admin" as const : "member" as const };
}

async function ensureBootstrapAdmin() {
  if (!OIDC_BOOTSTRAP_ACCOUNT) return;
  const allUsers = await db.select().from(users);
  const account = allUsers.find((user) => user.name.toLowerCase() === OIDC_BOOTSTRAP_ACCOUNT);
  if (account && account.role !== "admin") {
    await db.update(users).set({ role: "admin" }).where(eq(users.id, account.id));
  }
}

function loadOrCreateSecret(dataDir: string): string {
  const secretPath = path.join(dataDir, ".cookie-secret");
  if (fs.existsSync(secretPath)) {
    fs.chmodSync(secretPath, 0o600);
    return fs.readFileSync(secretPath, "utf8").trim();
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

function setSessionCookie(reply: import("fastify").FastifyReply, token: string) {
  reply.setCookie(COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    maxAge: SESSION_MS / 1000,
  });
}

function clearSession(reply: import("fastify").FastifyReply) {
  // Keep every attribute aligned with setSessionCookie(). Android WebView's cookie
  // store can retain a Secure cookie when the clearing Set-Cookie omits the
  // matching security attributes, making a closed/reopened app appear to
  // silently log itself back in after logout.
  reply.clearCookie(COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
  });
}

interface LiveSession {
  userId: string;
  tokenHash: string;
  expiresAt: number;
  refreshedAt: number;
  oidcSid: string | null;
}

function sessionTokenHash(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("base64url");
}

async function createSession(reply: import("fastify").FastifyReply, userId: string, oidcSid: string | null = null) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  await db.delete(appSessions).where(lt(appSessions.expiresAt, now));
  await db.insert(appSessions).values({
    tokenHash: sessionTokenHash(token),
    userId,
    oidcSid,
    expiresAt: now + SESSION_MS,
    refreshedAt: now,
    createdAt: now,
  });
  setSessionCookie(reply, token);
  return token;
}

async function liveSession(req: FastifyRequest, reply?: import("fastify").FastifyReply): Promise<LiveSession | null> {
  const raw = req.cookies[COOKIE_NAME];
  if (!raw) return null;
  const tokenHash = sessionTokenHash(raw);
  const [session] = await db.select().from(appSessions).where(eq(appSessions.tokenHash, tokenHash));
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt <= now) {
    await db.delete(appSessions).where(eq(appSessions.tokenHash, tokenHash));
    return null;
  }
  if (now - session.refreshedAt >= SESSION_REFRESH_AFTER_MS) {
    const expiresAt = now + SESSION_MS;
    await db.update(appSessions).set({ expiresAt, refreshedAt: now }).where(eq(appSessions.tokenHash, tokenHash));
    if (reply) setSessionCookie(reply, raw);
    return { ...session, tokenHash, expiresAt, refreshedAt: now };
  }
  return { ...session, tokenHash };
}

async function revokePresentedSession(req: FastifyRequest) {
  const token = req.cookies[COOKIE_NAME];
  if (token) await db.delete(appSessions).where(eq(appSessions.tokenHash, sessionTokenHash(token)));
}

export function revokeUserSessions(userId: string): number {
  return sqlite.prepare("DELETE FROM app_sessions WHERE user_id = ?").run(userId).changes;
}

export function revokeOidcSessions(subject?: string, sessionId?: string): number {
  if (!subject && !sessionId) return 0;
  return sqlite.prepare(`DELETE FROM app_sessions
    WHERE (? IS NOT NULL AND oidc_sid = ?)
       OR (? IS NOT NULL AND user_id IN (SELECT id FROM users WHERE oidc_sub = ?))`)
    .run(sessionId ?? null, sessionId ?? null, subject ?? null, subject ?? null).changes;
}

function getOidcIssuer() {
  if (!OIDC_ISSUER) throw new Error("Authentik is not configured");
  oidcIssuerPromise ??= Issuer.discover(OIDC_ISSUER);
  return oidcIssuerPromise;
}

function getOidcClient(): Promise<Client> {
  if (!oidcClientPromise) {
    oidcClientPromise = getOidcIssuer().then((issuer) => new issuer.Client({
      client_id: OIDC_CLIENT_ID,
      token_endpoint_auth_method: "none",
      response_types: ["code"],
    }));
  }
  return oidcClientPromise;
}

function getBackchannelVerifier() {
  if (!backchannelVerifierPromise) {
    backchannelVerifierPromise = getOidcIssuer().then((issuer) => {
      if (!issuer.metadata.issuer || !issuer.metadata.jwks_uri) {
        throw new Error("Authentik discovery did not provide logout verification metadata");
      }
      return createRemoteBackchannelLogoutVerifier(issuer.metadata.issuer, OIDC_CLIENT_ID, issuer.metadata.jwks_uri);
    });
  }
  return backchannelVerifierPromise;
}

function requestOrigin(req: FastifyRequest): string {
  const origin = `https://${req.headers.host ?? ""}`;
  if (!OIDC_REDIRECT_ORIGINS.has(origin)) throw new Error("This MacroDaddy address is not approved for sign-in");
  return origin;
}

interface OidcTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
  androidChallenge?: string;
}

const BASE64URL_256 = /^[A-Za-z0-9_-]{43}$/;
const ANDROID_HANDOFF_MS = 2 * 60 * 1000;

function readOidcTransaction(req: FastifyRequest): OidcTransaction | null {
  const raw = req.cookies[OIDC_COOKIE_NAME];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(unsigned.value, "base64url").toString("utf8")) as OidcTransaction;
    return parsed.createdAt > Date.now() - 10 * 60 * 1000 ? parsed : null;
  } catch {
    return null;
  }
}

async function uniqueName(preferred: string): Promise<string> {
  const allUsers = await db.select().from(users);
  const existing = new Set(allUsers.map((user) => user.name.toLowerCase()));
  const base = preferred.trim().slice(0, 32) || "Family member";
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, 35)} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function userForOidcClaims(claims: Record<string, unknown>) {
  const subject = String(claims.sub || "");
  if (!subject) throw new Error("Authentik did not return a user identifier");
  const [linked] = await db.select().from(users).where(eq(users.oidcSub, subject));
  const claimedUsername = String(claims.preferred_username || "").trim().toLowerCase();
  if (linked) {
    if (linked.disabledAt) throw new AccountBlockedError();
    if (claimedUsername === OIDC_BOOTSTRAP_USERNAME && linked.role !== "admin") {
      await db.update(users).set({ role: "admin" }).where(eq(users.id, linked.id));
      return { ...linked, role: "admin" };
    }
    return linked;
  }

  let account: typeof users.$inferSelect | undefined;
  if (claimedUsername === OIDC_BOOTSTRAP_USERNAME && OIDC_BOOTSTRAP_ACCOUNT) {
    [account] = await db.select().from(users).where(eq(users.name, process.env.OIDC_BOOTSTRAP_ACCOUNT?.trim() || ""));
  }
  if (!account && claimedUsername === OIDC_BOOTSTRAP_USERNAME && OIDC_BOOTSTRAP_ACCOUNT) {
    const allUsers = await db.select().from(users);
    account = allUsers.find((user) => user.name.toLowerCase() === OIDC_BOOTSTRAP_ACCOUNT);
  }
  if (!account && claimedUsername) {
    const claimedName = String(claims.name || "").trim().toLowerCase();
    const allUsers = await db.select().from(users);
    account = allUsers.find((user) => !user.oidcSub && (
      user.name.toLowerCase() === claimedUsername || (claimedName && user.name.toLowerCase() === claimedName)
    ));
  }

  if (account) {
    // Blocks the name-adoption path too, not just re-linking: an unlinked
    // account is claimable by whoever signs in with a matching name, so a
    // blocked one must not become a way back in under a new `sub`.
    if (account.disabledAt) throw new AccountBlockedError();
    if (account.oidcSub && account.oidcSub !== subject) throw new Error("That account is already linked to another Authentik user");
    const role = claimedUsername === OIDC_BOOTSTRAP_USERNAME ? "admin" : account.role;
    await db.update(users).set({ oidcSub: subject, role }).where(eq(users.id, account.id));
    return { ...account, oidcSub: subject, role };
  }

  const name = await uniqueName(String(claims.name || claims.preferred_username || "Family member"));
  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(crypto.randomBytes(48).toString("base64url"), 10);
  await db.insert(users).values({ id, name, passwordHash, oidcSub: subject, createdAt: new Date().toISOString() });
  return { id, name, passwordHash, oidcSub: subject, role: "member", createdAt: new Date().toISOString() };
}

const signupSchema = z.object({
  name: z.string().trim().min(1).max(40),
  password: z.string().min(8).max(200),
});

export async function registerAuth(app: FastifyInstance, dataDir: string) {
  const secret = process.env.COOKIE_SECRET ?? loadOrCreateSecret(dataDir);
  await app.register(fastifyCookie, { secret });
  await app.register(fastifyFormbody);
  app.decorateRequest("userId", undefined);
  await ensureBootstrapAdmin();
  const androidHandoffs = new Map<string, { challenge: string; token: string; expiresAt: number }>();

  app.get<{ Querystring: { client?: string; handoff_challenge?: string } }>("/api/auth/oidc/start", async (req, reply) => {
    try {
      const client = await getOidcClient();
      const redirectUri = `${requestOrigin(req)}/api/auth/oidc/callback`;
      const transaction: OidcTransaction = {
        state: generators.state(),
        nonce: generators.nonce(),
        codeVerifier: generators.codeVerifier(),
        redirectUri,
        createdAt: Date.now(),
        ...(req.query.client === "android" ? { androidChallenge: req.query.handoff_challenge } : {}),
      };
      if (req.query.client === "android" && !BASE64URL_256.test(transaction.androidChallenge ?? "")) return reply.code(400).send({ error: "Invalid Android sign-in request" });
      reply.setCookie(OIDC_COOKIE_NAME, Buffer.from(JSON.stringify(transaction)).toString("base64url"), {
        path: "/api/auth/oidc",
        httpOnly: true,
        secure: secureCookies,
        sameSite: "lax",
        signed: true,
        maxAge: 10 * 60,
      });
      return reply.redirect(client.authorizationUrl({
        scope: "openid profile email",
        redirect_uri: redirectUri,
        state: transaction.state,
        nonce: transaction.nonce,
        code_challenge: generators.codeChallenge(transaction.codeVerifier),
        code_challenge_method: "S256",
      }));
    } catch (error) {
      req.log.error({ err: error }, "Authentik sign-in could not start");
      return reply.code(503).send("Authentik sign-in could not start. Please try again.");
    }
  });

  app.get("/api/auth/oidc/callback", async (req, reply) => {
    const transaction = readOidcTransaction(req);
    reply.clearCookie(OIDC_COOKIE_NAME, {
      path: "/api/auth/oidc",
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
    });
    if (!transaction) return reply.code(400).send("The sign-in request expired. Return to MacroDaddy and try again.");
    try {
      const client = await getOidcClient();
      const tokens = await client.callback(transaction.redirectUri, client.callbackParams(req.raw), {
        state: transaction.state,
        nonce: transaction.nonce,
        code_verifier: transaction.codeVerifier,
      });
      const claims = tokens.claims();
      const user = await userForOidcClaims(claims);
      const token = await createSession(reply, user.id, typeof claims.sid === "string" ? claims.sid : null);
      if (transaction.androidChallenge) {
        const code = crypto.randomBytes(32).toString("base64url");
        androidHandoffs.set(code, { challenge: transaction.androidChallenge, token, expiresAt: Date.now() + ANDROID_HANDOFF_MS });
        return reply.redirect(`macrodaddy://auth/callback?code=${encodeURIComponent(code)}`);
      }
      return reply.redirect("/");
    } catch (error) {
      if (error instanceof AccountBlockedError) {
        req.log.warn("blocked account attempted Authentik sign-in");
        return reply.code(403).send("This MacroDaddy account has been blocked. Ask the account administrator to restore it.");
      }
      req.log.error({ err: error }, "Authentik callback failed");
      return reply.code(401).send("Authentik sign-in failed. Return to MacroDaddy and try again.");
    }
  });

  app.get<{ Querystring: { code?: string; verifier?: string } }>("/api/auth/android/complete", async (req, reply) => {
    const code = req.query.code ?? "";
    const verifier = req.query.verifier ?? "";
    if (!BASE64URL_256.test(code) || !BASE64URL_256.test(verifier)) return reply.code(400).send({ error: "Invalid or expired Android sign-in" });
    const handoff = androidHandoffs.get(code);
    if (!handoff || handoff.expiresAt <= Date.now()) { androidHandoffs.delete(code); return reply.code(400).send({ error: "Invalid or expired Android sign-in" }); }
    const expected = Buffer.from(handoff.challenge);
    const actual = Buffer.from(crypto.createHash("sha256").update(verifier, "ascii").digest("base64url"));
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return reply.code(400).send({ error: "Invalid or expired Android sign-in" });
    androidHandoffs.delete(code);
    const [session] = await db.select().from(appSessions).where(eq(appSessions.tokenHash, sessionTokenHash(handoff.token)));
    if (!session || session.expiresAt <= Date.now()) return reply.code(400).send({ error: "Android sign-in session expired" });
    setSessionCookie(reply, handoff.token);
    return reply.redirect("/");
  });

  app.post("/api/auth/signup", async (req, reply) => {
    if (OIDC_ISSUER) return reply.code(404).send({ error: "Create family accounts in Authentik" });
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter a name and a password of at least 8 characters" });
    const { name, password } = parsed.data;
    const [existing] = await db.select().from(users).where(eq(users.name, name));
    if (existing) return reply.code(409).send({ error: "That name is already taken" });
    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    const role = (await db.select({ id: users.id }).from(users)).length === 0 ? "admin" : "member";
    await db.insert(users).values({ id, name, passwordHash, role, createdAt: new Date().toISOString() });
    await createSession(reply, id);
    return reply.code(201).send({ ok: true, user: { id, name, role } });
  });

  app.post("/api/auth/login", async (req, reply) => {
    if (OIDC_ISSUER) return reply.code(404).send({ error: "Sign in with Authentik" });
    const body = req.body as { password?: string };
    if (!body?.password) return reply.code(401).send({ error: "Incorrect password" });
    const allUsers = await db.select().from(users);
    for (const user of allUsers) {
      if (await bcrypt.compare(body.password, user.passwordHash)) {
        await createSession(reply, user.id);
        return { ok: true, user: publicUser(user) };
      }
    }
    return reply.code(401).send({ error: "Incorrect password" });
  });

  app.post("/api/auth/logout", async (req, reply) => {
    // Delete only the presented server-side session. Administrative account
    // or Authentik revocation uses the separate subject/session-aware paths.
    await revokePresentedSession(req);
    clearSession(reply);
    return { ok: true };
  });

  app.post<{ Body: { logout_token?: unknown } }>("/api/auth/backchannel-logout", async (req, reply) => {
    if (typeof req.body?.logout_token !== "string" || !req.body.logout_token) {
      return reply.code(400).send({ error: "Invalid logout token" });
    }
    try {
      const claims = await (await getBackchannelVerifier())(req.body.logout_token);
      return { ok: true, revoked: revokeOidcSessions(claims.subject, claims.sessionId) };
    } catch (error) {
      req.log.warn({ err: error }, "Rejected invalid Authentik back-channel logout token");
      return reply.code(400).send({ error: "Invalid logout token" });
    }
  });

  app.get("/api/auth/status", async (req, reply) => {
    const session = await liveSession(req, reply);
    if (!session) return { authenticated: false };
    const [user] = await db.select().from(users).where(eq(users.id, session.userId));
    // A deleted or blocked account reports as signed out rather than as an
    // error, so the client falls through to its normal login screen instead
    // of sitting on a broken session it cannot explain.
    if (!user || user.disabledAt) return { authenticated: false };
    return { authenticated: true, user: publicUser(user) };
  });

  app.addHook("preHandler", async (req, reply) => {
    const url = req.raw.url ?? "";
    if (!url.startsWith("/api/")) return;
    if (url.startsWith("/api/auth/") || url.startsWith("/api/android/") || url === "/api/health"
      || url === "/api/steps/webhook"
      // Bearer-token machine endpoints — they authenticate themselves
      // against integration_tokens, not against a session cookie. The
      // /api/integrations/tokens management routes are NOT exempt.
      || url === "/api/integrations/recipe-log"
      || url === "/api/integrations/recipe-log/ping") return;
    const session = await liveSession(req, reply);
    if (!session) {
      reply.code(401).send({ error: "Not authenticated" });
      return;
    }
    const userId = session.userId;
    // The session row proves the bearer token is live; this separate lookup
    // also enforces account deletion and local administrator blocking on every
    // request. A primary-key read on better-sqlite3 is cheap enough that
    // caching it would only add staleness.
    const [user] = await db
      .select({
        id: users.id,
        disabledAt: users.disabledAt,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) {
      reply.code(401).send({ error: "Not authenticated" });
      return;
    }
    if (user.disabledAt) {
      reply.code(403).send({ error: "This account has been blocked" });
      return;
    }

    const lastSeen = user.lastSeenAt ? Date.parse(user.lastSeenAt) : Number.NaN;
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > LAST_SEEN_THROTTLE_MS) {
      await db.update(users).set({ lastSeenAt: new Date().toISOString() }).where(eq(users.id, userId));
    }

    req.userId = userId;
  });
}
