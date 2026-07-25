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
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

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

export async function registerAuth(app: FastifyInstance, dataDir: string) {
  const secret = process.env.COOKIE_SECRET ?? loadOrCreateSecret(dataDir);
  await app.register(fastifyCookie, { secret });
  app.decorateRequest("userId", undefined);

  // Anyone who can reach this instance over the tailnet can create an account —
  // there's no invite/approval step. That's fine for a closed household app
  // where Tailscale ACLs are already the real access boundary (same model as
  // every other service in this stack); it would need rethinking if this ever
  // stopped being just-the-household.
  app.post("/api/auth/signup", async (req, reply) => {
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
