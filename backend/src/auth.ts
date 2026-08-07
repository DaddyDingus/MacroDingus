import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { users } from "./db/schema.js";
import {
  authorizationUrl,
  createAuthRequestState,
  exchangeCode,
  isAuthorized,
  loadOidcConfig,
  type AuthRequestState,
} from "./oidc.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

const COOKIE_NAME = "mt_session";

// Sessions are stateless signed cookies with no server-side store, so a
// stolen one cannot be revoked individually — not even by changing the
// password. 7 days rather than the previous 30 bounds that exposure without
// making daily use annoying. The break-glass "log everyone out now" control
// is rotating MACRODINGUS_COOKIE_SECRET (or deleting data/.cookie-secret).
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

// Secure cookies are the default and are what production runs. The opt-out
// exists only for running with no TLS at all on a trusted LAN; a browser will
// refuse to store a Secure cookie over plain http, so leaving this on in that
// setup silently breaks login rather than failing loudly.
const COOKIE_SECURE = process.env.MACRODINGUS_COOKIE_SECURE !== "false";

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
    sameSite: "lax",
    secure: COOKIE_SECURE,
    signed: true,
    maxAge: SESSION_MS / 1000,
  });
}

function parseSession(req: FastifyRequest): string | null {
  const raw = req.cookies[COOKIE_NAME];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const dot = unsigned.value.lastIndexOf(".");
  if (dot === -1) return null;
  const userId = unsigned.value.slice(0, dot);
  const expiry = Number(unsigned.value.slice(dot + 1));
  if (!userId || !Number.isFinite(expiry) || expiry <= Date.now()) return null;
  return userId;
}

const signupSchema = z.object({
  name: z.string().trim().min(1).max(40),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  name: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
});

// One message for every failure mode. "No such name" and "wrong password"
// must be indistinguishable, or the endpoint becomes a way to enumerate who
// has an account here.
const INVALID_CREDENTIALS = "Incorrect name or password";

// A real bcrypt hash (of a value nobody can supply — bcrypt silently
// truncates at 72 bytes, so this can never be matched) used purely to burn
// comparable CPU when the named account does not exist. Cost 10 matches what
// signup writes.
const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const ALLOW_SIGNUP = process.env.MACRODINGUS_ALLOW_SIGNUP === "true";

// Tight bucket for the two unauthenticated endpoints. Deliberately much
// stricter than the global limit: nobody legitimately gets their own password
// wrong six times in a quarter of an hour, and this is the control standing
// between a single guessable password and every food log, weigh-in and
// progress photo in the database.
export const AUTH_RATE_LIMIT = { max: 5, timeWindow: "15 minutes" };

const OIDC_STATE_COOKIE = "mt_oidc";

/**
 * Maps a verified OIDC identity onto a local user row, creating one on first
 * sign-in. Returns the local user id.
 *
 * Match order matters:
 *  1. oidc_sub — the only stable identifier. Survives a rename on either side.
 *  2. name, but ONLY to adopt an existing local account that has never been
 *     linked. This is what lets an account created by local signup become the
 *     same account after SSO is switched on, instead of silently stranding its
 *     history behind a second, empty account.
 *
 * Step 2 trusts the provider to own its usernames. That is sound here — the
 * IdP is the authority and an optional group gate has already been applied
 * above — but it is the reason MACRODINGUS_OIDC_REQUIRED_GROUP is worth
 * setting on a provider where anyone can self-register.
 */
async function resolveOidcUser(identity: { subject: string; username: string }): Promise<string> {
  const [linked] = await db.select().from(users).where(eq(users.oidcSub, identity.subject));
  if (linked) return linked.id;

  const [byName] = await db.select().from(users).where(eq(users.name, identity.username));
  if (byName) {
    if (!byName.oidcSub) {
      await db.update(users).set({ oidcSub: identity.subject }).where(eq(users.id, byName.id));
      return byName.id;
    }
    // Name is taken by a DIFFERENT subject. Never merge — that would hand one
    // person another's food diary. Fall through and create a distinct account.
  }

  const id = crypto.randomUUID();
  // A random hash nobody holds the input to: the account exists and is fully
  // usable via SSO, but has no local password until its owner sets one. Using
  // a real bcrypt hash (not a sentinel) keeps the local login path uniform —
  // it simply never matches.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

  let name = identity.username;
  if (byName) name = `${identity.username}-${identity.subject.slice(0, 6)}`.slice(0, 40);

  await db.insert(users).values({
    id,
    name,
    passwordHash,
    oidcSub: identity.subject,
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function registerAuth(app: FastifyInstance, dataDir: string) {
  // Prefer an explicitly managed secret so rotation is a config change rather
  // than deleting a file inside a volume. COOKIE_SECRET is kept as an alias
  // for anyone tracking upstream. Falling back to the on-disk file keeps a
  // fresh install working with no configuration at all.
  const secret =
    process.env.MACRODINGUS_COOKIE_SECRET?.trim() ||
    process.env.COOKIE_SECRET?.trim() ||
    loadOrCreateSecret(dataDir);
  await app.register(fastifyCookie, { secret });
  app.decorateRequest("userId", undefined);

  // Self-service signup is OFF by default. Turn it on only long enough to
  // create the account, then turn it back off. Upstream left this permanently
  // open because Tailscale ACLs were the real boundary; with the sidecar gone
  // an open signup endpoint is just unauthenticated write surface.
  //
  // 404 rather than 403 deliberately: a 403 confirms the endpoint exists and
  // is merely disabled, which tells a scanner this app has accounts worth
  // attacking. A 404 is indistinguishable from the route not being there.
  app.post("/api/auth/signup", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (req, reply) => {
    if (!ALLOW_SIGNUP) {
      reply.code(404);
      return { error: "not found" };
    }
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Enter a name and a password of at least 8 characters" };
    }
    const { name, password } = parsed.data;
    const [existing] = await db.select().from(users).where(eq(users.name, name));
    if (existing) {
      reply.code(409);
      return { error: "That name is already taken" };
    }
    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(users).values({ id, name, passwordHash, createdAt: new Date().toISOString() });
    signSession(reply, id);
    reply.code(201);
    return { ok: true, user: { id, name } };
  });

  // Login takes a name AND a password. It used to take a bare password and
  // bcrypt.compare it against every user row until one matched, which meant:
  // an attacker succeeded by guessing ANY account's password rather than a
  // specific one; two accounts sharing a password logged you into whichever
  // row came back first; and every attempt cost one bcrypt per user, so a
  // handful of concurrent requests saturated libuv's threadpool and stalled
  // the process. `users.name` was already NOT NULL UNIQUE, so this needed no
  // migration — just the lookup it should always have been.
  app.post("/api/auth/login", { config: { rateLimit: AUTH_RATE_LIMIT } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(401);
      return { error: INVALID_CREDENTIALS };
    }

    const [user] = await db.select().from(users).where(eq(users.name, parsed.data.name));

    // Hash against a dummy when the name is unknown so the response takes
    // comparable time either way — otherwise the timing difference between
    // "no such user" (instant) and "wrong password" (one bcrypt) is a name
    // oracle, and the single generic message below would be for nothing.
    if (!user) {
      await bcrypt.compare(parsed.data.password, DUMMY_HASH);
      reply.code(401);
      return { error: INVALID_CREDENTIALS };
    }

    if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      reply.code(401);
      return { error: INVALID_CREDENTIALS };
    }

    signSession(reply, user.id);
    return { ok: true, user: { id: user.id, name: user.name } };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    // Attributes must match those the cookie was set with, or some browsers
    // keep the original alongside the cleared one and the session survives.
    reply.clearCookie(COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: COOKIE_SECURE,
    });
    return { ok: true };
  });

  app.get("/api/auth/status", async (req) => {
    const userId = parseSession(req);
    if (!userId) return { authenticated: false };
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return { authenticated: false };
    return { authenticated: true, user: { id: user.id, name: user.name } };
  });

  // ── OIDC single sign-on (optional) ────────────────────────────────────────
  const oidc = loadOidcConfig();
  if (oidc) {
    app.log.info({ issuer: oidc.issuer, group: oidc.requiredGroup }, "OIDC sign-in enabled");
  }

  // Public: lets the login screen decide whether to render the SSO button
  // without hard-coding build-time knowledge of the deployment.
  app.get("/api/auth/oidc/config", async () =>
    oidc ? { enabled: true, providerName: oidc.providerName } : { enabled: false }
  );

  app.get("/api/auth/oidc/start", async (req, reply) => {
    if (!oidc) return reply.code(404).send({ error: "not found" });

    const request = createAuthRequestState();
    // The PKCE verifier, state and nonce live in a short-lived signed cookie
    // rather than server memory: there is nothing to clean up, and it survives
    // a container restart mid-login. Signed, so the client cannot forge one.
    reply.setCookie(OIDC_STATE_COOKIE, JSON.stringify(request), {
      path: "/api/auth/oidc",
      httpOnly: true,
      sameSite: "lax", // must not be "strict" — the IdP redirect is cross-site
      secure: COOKIE_SECURE,
      signed: true,
      maxAge: 600,
    });

    try {
      return reply.redirect(await authorizationUrl(oidc, request));
    } catch (err) {
      req.log.error({ err }, "OIDC authorization URL failed");
      return reply.redirect("/?sso=unavailable");
    }
  });

  app.get("/api/auth/oidc/callback", async (req, reply) => {
    if (!oidc) return reply.code(404).send({ error: "not found" });

    const clearState = () => reply.clearCookie(OIDC_STATE_COOKIE, { path: "/api/auth/oidc" });
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    if (error || !code || !state) {
      clearState();
      return reply.redirect("/?sso=failed");
    }

    const raw = req.cookies[OIDC_STATE_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    if (!unsigned?.valid || !unsigned.value) {
      clearState();
      return reply.redirect("/?sso=failed");
    }

    let request: AuthRequestState;
    try {
      request = JSON.parse(unsigned.value) as AuthRequestState;
    } catch {
      clearState();
      return reply.redirect("/?sso=failed");
    }

    // CSRF defence for the callback itself: without this, an attacker can
    // feed you their own authorization code and land you in their account.
    if (
      typeof request.state !== "string" ||
      request.state.length !== state.length ||
      !crypto.timingSafeEqual(Buffer.from(request.state), Buffer.from(state))
    ) {
      clearState();
      return reply.redirect("/?sso=failed");
    }

    let identity;
    try {
      identity = await exchangeCode(oidc, code, request);
    } catch (err) {
      req.log.error({ err }, "OIDC code exchange failed");
      clearState();
      return reply.redirect("/?sso=failed");
    }

    if (!isAuthorized(oidc, identity)) {
      req.log.warn({ sub: identity.subject }, "OIDC sign-in denied: missing required group");
      clearState();
      return reply.redirect("/?sso=denied");
    }

    const userId = await resolveOidcUser(identity);
    clearState();
    signSession(reply, userId);
    return reply.redirect("/");
  });

  app.addHook("preHandler", async (req, reply) => {
    const url = req.raw.url ?? "";
    if (!url.startsWith("/api/")) return;
    if (url.startsWith("/api/auth/") || url === "/api/health") return;
    const userId = parseSession(req);
    if (!userId) {
      reply.code(401).send({ error: "Not authenticated" });
      return;
    }
    req.userId = userId;
  });
}
