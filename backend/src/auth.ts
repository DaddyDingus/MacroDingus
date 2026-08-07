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
