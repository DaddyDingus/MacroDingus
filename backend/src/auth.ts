import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";

const COOKIE_NAME = "mt_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function loadOrCreateSecret(dataDir: string): string {
  const secretPath = path.join(dataDir, ".cookie-secret");
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, "utf8").trim();
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

function passwordsMatch(submitted: string, actual: string): boolean {
  const a = Buffer.from(submitted);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function registerAuth(app: FastifyInstance, dataDir: string) {
  const password = process.env.AUTH_PASSWORD;
  if (!password) throw new Error("AUTH_PASSWORD env var is required");
  const secret = process.env.COOKIE_SECRET ?? loadOrCreateSecret(dataDir);

  await app.register(fastifyCookie, { secret });

  function isAuthed(req: FastifyRequest): boolean {
    const raw = req.cookies[COOKIE_NAME];
    if (!raw) return false;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return false;
    const expiry = Number(unsigned.value);
    return Number.isFinite(expiry) && expiry > Date.now();
  }

  app.post("/api/auth/login", async (req, reply) => {
    const body = req.body as { password?: string };
    if (!body?.password || !passwordsMatch(body.password, password)) {
      reply.code(401);
      return { error: "Incorrect password" };
    }
    reply.setCookie(COOKIE_NAME, String(Date.now() + SESSION_MS), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      signed: true,
      maxAge: SESSION_MS / 1000,
    });
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/status", async (req) => ({ authenticated: isAuthed(req) }));

  app.addHook("preHandler", async (req, reply) => {
    const url = req.raw.url ?? "";
    if (!url.startsWith("/api/")) return;
    if (url.startsWith("/api/auth/") || url === "/api/health") return;
    if (!isAuthed(req)) {
      reply.code(401).send({ error: "Not authenticated" });
    }
  });
}
