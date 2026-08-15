import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Issuer, generators, type Client } from "openid-client";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { users } from "./db/schema.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

const COOKIE_NAME = "mt_session";
const OIDC_COOKIE_NAME = "mt_oidc";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const OIDC_ISSUER = process.env.OIDC_ISSUER?.trim() ?? "";
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID?.trim() || "macrodaddy";
const OIDC_REDIRECT_ORIGINS = new Set((process.env.OIDC_REDIRECT_ORIGINS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean));
const OIDC_BOOTSTRAP_USERNAME = process.env.OIDC_BOOTSTRAP_USERNAME?.trim().toLowerCase() ?? "";
const OIDC_BOOTSTRAP_ACCOUNT = process.env.OIDC_BOOTSTRAP_ACCOUNT?.trim().toLowerCase() ?? "";
const secureCookies = process.env.NODE_ENV === "production";
let oidcClientPromise: Promise<Client> | null = null;
let revokedSessionsPath = "";
const revokedSessions = new Map<string, number>();

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
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, "utf8").trim();
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

function signSession(reply: import("fastify").FastifyReply, userId: string) {
  reply.setCookie(COOKIE_NAME, `${userId}.${Date.now() + SESSION_MS}`, {
    path: "/",
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    signed: true,
    maxAge: SESSION_MS / 1000,
  });
}

function clearSession(reply: import("fastify").FastifyReply) {
  // Keep every attribute aligned with signSession(). Android WebView's cookie
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

interface SessionPayload {
  userId: string;
  expiry: number;
  fingerprint: string;
}

function sessionFingerprint(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function initializeSessionRevocations(dataDir: string) {
  revokedSessionsPath = path.join(dataDir, ".revoked-sessions.json");
  revokedSessions.clear();
  if (!fs.existsSync(revokedSessionsPath)) return;
  const stored = JSON.parse(fs.readFileSync(revokedSessionsPath, "utf8")) as Record<string, unknown>;
  const now = Date.now();
  for (const [fingerprint, expiry] of Object.entries(stored)) {
    if (/^[a-f0-9]{64}$/.test(fingerprint) && typeof expiry === "number" && expiry > now) {
      revokedSessions.set(fingerprint, expiry);
    }
  }
}

function persistSessionRevocations() {
  if (!revokedSessionsPath) throw new Error("Session revocations are not initialized");
  const now = Date.now();
  for (const [fingerprint, expiry] of revokedSessions) {
    if (expiry <= now) revokedSessions.delete(fingerprint);
  }
  const temporaryPath = `${revokedSessionsPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(Object.fromEntries(revokedSessions)), { mode: 0o600 });
  fs.renameSync(temporaryPath, revokedSessionsPath);
}

function decodeSession(req: FastifyRequest): SessionPayload | null {
  const raw = req.cookies[COOKIE_NAME];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const dot = unsigned.value.lastIndexOf(".");
  if (dot === -1) return null;
  const userId = unsigned.value.slice(0, dot);
  const expiry = Number(unsigned.value.slice(dot + 1));
  if (!userId || !Number.isFinite(expiry) || expiry <= Date.now()) return null;
  return { userId, expiry, fingerprint: sessionFingerprint(raw) };
}

function parseSession(req: FastifyRequest): string | null {
  const session = decodeSession(req);
  if (!session || revokedSessions.has(session.fingerprint)) return null;
  return session.userId;
}

function revokeSession(req: FastifyRequest) {
  const session = decodeSession(req);
  if (!session) return;
  revokedSessions.set(session.fingerprint, session.expiry);
  persistSessionRevocations();
}

function getOidcClient(): Promise<Client> {
  if (!OIDC_ISSUER) throw new Error("Authentik is not configured");
  if (!oidcClientPromise) {
    oidcClientPromise = Issuer.discover(OIDC_ISSUER).then((issuer) => new issuer.Client({
      client_id: OIDC_CLIENT_ID,
      token_endpoint_auth_method: "none",
      response_types: ["code"],
    }));
  }
  return oidcClientPromise;
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
}

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
  initializeSessionRevocations(dataDir);
  await app.register(fastifyCookie, { secret });
  app.decorateRequest("userId", undefined);
  await ensureBootstrapAdmin();

  app.get("/api/auth/oidc/start", async (req, reply) => {
    try {
      const client = await getOidcClient();
      const redirectUri = `${requestOrigin(req)}/api/auth/oidc/callback`;
      const transaction: OidcTransaction = {
        state: generators.state(),
        nonce: generators.nonce(),
        codeVerifier: generators.codeVerifier(),
        redirectUri,
        createdAt: Date.now(),
      };
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
      const user = await userForOidcClaims(tokens.claims());
      signSession(reply, user.id);
      return reply.redirect("/");
    } catch (error) {
      req.log.error({ err: error }, "Authentik callback failed");
      return reply.code(401).send("Authentik sign-in failed. Return to MacroDaddy and try again.");
    }
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
    signSession(reply, id);
    return reply.code(201).send({ ok: true, user: { id, name, role } });
  });

  app.post("/api/auth/login", async (req, reply) => {
    if (OIDC_ISSUER) return reply.code(404).send({ error: "Sign in with Authentik" });
    const body = req.body as { password?: string };
    if (!body?.password) return reply.code(401).send({ error: "Incorrect password" });
    const allUsers = await db.select().from(users);
    for (const user of allUsers) {
      if (await bcrypt.compare(body.password, user.passwordHash)) {
        signSession(reply, user.id);
        return { ok: true, user: publicUser(user) };
      }
    }
    return reply.code(401).send({ error: "Incorrect password" });
  });

  app.post("/api/auth/logout", async (req, reply) => {
    // WebViews have been observed restoring a cookie after honoring the logout
    // response. Revoke this exact signed session as well, so replaying that
    // stale cookie cannot restore access. Other devices remain signed in.
    revokeSession(req);
    clearSession(reply);
    return { ok: true };
  });

  app.get("/api/auth/status", async (req) => {
    const userId = parseSession(req);
    if (!userId) return { authenticated: false };
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return { authenticated: false };
    return { authenticated: true, user: publicUser(user) };
  });

  app.addHook("preHandler", async (req, reply) => {
    const url = req.raw.url ?? "";
    if (!url.startsWith("/api/")) return;
    if (url.startsWith("/api/auth/") || url.startsWith("/api/android/") || url === "/api/health" || url === "/api/steps/webhook") return;
    const userId = parseSession(req);
    if (!userId) {
      reply.code(401).send({ error: "Not authenticated" });
      return;
    }
    req.userId = userId;
  });
}
