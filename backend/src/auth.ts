import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { users, logs } from "./db/schema.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

const COOKIE_NAME = "mt_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function loadOrCreateSecret(dataDir: string): string {
  const secretPath = path.join(dataDir, ".cookie-secret");
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, "utf8").trim();
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

// AUTH_USERS format: "Name:password,Name2:password2" — parsed once at boot.
// A user row is only ever created if that name doesn't already exist, so this
// just sets the *initial* password; nothing here overwrites a stored hash on
// every restart (matters once there's a way to change your own password).
async function seedUsers() {
  const raw = process.env.AUTH_USERS;
  if (!raw) {
    throw new Error('AUTH_USERS env var is required, format: "Name:password,Name2:password2"');
  }
  const pairs = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const createdIds: string[] = [];
  for (const pair of pairs) {
    const idx = pair.indexOf(":");
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    const password = pair.slice(idx + 1);
    if (!name || !password) continue;

    const [existing] = await db.select().from(users).where(eq(users.name, name));
    if (existing) continue;

    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(users).values({ id, name, passwordHash, createdAt: new Date().toISOString() });
    createdIds.push(id);
  }

  // Migration 0001 added logs.user_id as NOT NULL DEFAULT '' to satisfy SQLite's
  // ALTER TABLE requirement on a column with existing rows. Any row still holding
  // that placeholder predates multi-user support entirely, so it belongs to
  // whichever user was seeded first.
  if (createdIds.length > 0) {
    await db.update(logs).set({ userId: createdIds[0] }).where(eq(logs.userId, ""));
  }
}

function signSession(reply: import("fastify").FastifyReply, userId: string) {
  reply.setCookie(COOKIE_NAME, `${userId}.${Date.now() + SESSION_MS}`, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
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

export async function registerAuth(app: FastifyInstance, dataDir: string) {
  const secret = process.env.COOKIE_SECRET ?? loadOrCreateSecret(dataDir);
  await app.register(fastifyCookie, { secret });
  app.decorateRequest("userId", undefined);

  await seedUsers();

  app.post("/api/auth/login", async (req, reply) => {
    const body = req.body as { password?: string };
    if (!body?.password) {
      reply.code(401);
      return { error: "Incorrect password" };
    }
    const allUsers = await db.select().from(users);
    for (const user of allUsers) {
      if (await bcrypt.compare(body.password, user.passwordHash)) {
        signSession(reply, user.id);
        return { ok: true, user: { id: user.id, name: user.name } };
      }
    }
    reply.code(401);
    return { error: "Incorrect password" };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
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
