import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { count, eq, max } from "drizzle-orm";
import { db } from "../db/index.js";
import { logs, photos, users, weights } from "../db/schema.js";
import { createServerBackup } from "../lib/serverBackups.js";
import { purgeUserData } from "../lib/userData.js";
import { revokeUserSessions } from "../auth.js";

const accessSchema = z.object({ disabled: z.boolean() });

// Identity changes belong in the safer mobile administration console rather
// than Authentik's desktop-first admin UI. Forks can point at their own
// console; this household defaults to the canonical Auth Daddy people view.
function accountManagerUrl(): string | null {
  const configured = process.env.AUTH_DADDY_PEOPLE_URL?.trim()
    || "https://auth-daddy.tail984e80.ts.net/people";
  try {
    return new URL(configured).toString();
  } catch {
    return null;
  }
}

// The global preHandler in auth.ts proves only that a request is
// authenticated. Role is never checked there, so every route below has to ask
// for itself — an admin route that forgets this is simply a public route.
async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, req.userId!));
  if (user?.role !== "admin") {
    return reply.code(403).send({ error: "Administrator access is required" });
  }
}

export function registerAdminRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/admin/users", { preHandler: requireAdmin }, async (req) => {
    // Grouped aggregates rather than a query per account: trivial at
    // household scale, but this is the one screen that grows with the number
    // of people, and an N+1 here would be invisible until it wasn't.
    const [accounts, logStats, weightStats, photoStats] = await Promise.all([
      db.select().from(users),
      db.select({ userId: logs.userId, total: count(), lastDate: max(logs.date) }).from(logs).groupBy(logs.userId),
      db.select({ userId: weights.userId, total: count(), lastDate: max(weights.date) }).from(weights).groupBy(weights.userId),
      db.select({ userId: photos.userId, total: count() }).from(photos).groupBy(photos.userId),
    ]);

    const logsBy = new Map(logStats.map((row) => [row.userId, row]));
    const weightsBy = new Map(weightStats.map((row) => [row.userId, row]));
    const photosBy = new Map(photoStats.map((row) => [row.userId, row]));

    return {
      accountManagerUrl: accountManagerUrl(),
      users: accounts
        .map((account) => ({
          id: account.id,
          name: account.name,
          role: account.role === "admin" ? "admin" as const : "member" as const,
          createdAt: account.createdAt,
          lastSeenAt: account.lastSeenAt,
          disabledAt: account.disabledAt,
          // An unlinked account is not merely "not signed in yet" — auth.ts
          // hands it to whoever next signs in under a matching name, so the
          // screen has to be able to say that out loud.
          authentikLinked: Boolean(account.oidcSub),
          isSelf: account.id === req.userId,
          logCount: logsBy.get(account.id)?.total ?? 0,
          lastLoggedDate: logsBy.get(account.id)?.lastDate ?? null,
          weightCount: weightsBy.get(account.id)?.total ?? 0,
          lastWeightDate: weightsBy.get(account.id)?.lastDate ?? null,
          photoCount: photosBy.get(account.id)?.total ?? 0,
        }))
        .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name)),
    };
  });

  app.patch("/api/admin/users/:id/access", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = accessSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Specify whether the account is blocked" });
    const { id } = req.params as { id: string };

    // Self-lockout is the one irreversible mistake on this screen: blocking
    // yourself would refuse the very request that could undo it.
    if (id === req.userId) return reply.code(400).send({ error: "You can't block your own account" });

    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
    if (!target) return reply.code(404).send({ error: "That account no longer exists" });

    await db
      .update(users)
      .set({ disabledAt: parsed.data.disabled ? new Date().toISOString() : null })
      .where(eq(users.id, id));
    if (parsed.data.disabled) revokeUserSessions(id);
    return { ok: true };
  });

  app.delete("/api/admin/users/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    // Refusing self is the only guard needed to keep an administrator in the
    // household: the caller is an admin by definition here, so whoever
    // survives this call, they do.
    if (id === req.userId) return reply.code(400).send({ error: "You can't delete your own account" });

    const [target] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, id));
    if (!target) return reply.code(404).send({ error: "That account no longer exists" });

    try {
      // Same reasoning as the account import route: take a recoverable
      // snapshot immediately before an irreversible destructive write,
      // independent of the daily schedule.
      await createServerBackup();
      await purgeUserData(id, dataDir);
      await db.delete(users).where(eq(users.id, id));
    } catch (err) {
      req.log.error({ err }, "admin account delete failed");
      return reply.code(500).send({ error: "That account could not be deleted" });
    }

    reply.code(204);
    return null;
  });
}
