import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { logs, favorites, foodSearchStats, programDays, programs, checkins, goals, weights, photos, profiles, users } from "../db/schema.js";

const nameSchema = z.object({ name: z.string().trim().min(1).max(40) });
const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

// Self-service version of the manual DB wipe used to reset a test/mock
// account — scoped to exactly one user's own data. Deliberately does NOT
// touch `foods`/`recipes`: those are shared across every account (see
// schema.ts), not "this account's data", so a solo reset shouldn't nuke a
// shared library another household member's account still relies on.
// Clearing the profile is intentional, not incidental — it's what lets
// App.tsx's onboarding gate (no profile => OnboardingFlow) pick the account
// back up as fresh on the very next load, rather than leaving it in a
// half-reset state with no data but a still-configured profile.
export function registerAccountRoutes(app: FastifyInstance, dataDir: string) {
  app.patch("/api/account/name", async (req, reply) => {
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Enter a name" };
    }
    const userId = req.userId!;
    const { name } = parsed.data;

    const [existing] = await db.select({ id: users.id }).from(users).where(and(eq(users.name, name), ne(users.id, userId)));
    if (existing) {
      reply.code(409);
      return { error: "That name is already taken" };
    }

    await db.update(users).set({ name }).where(eq(users.id, userId));
    return { ok: true, user: { id: userId, name } };
  });

  app.patch("/api/account/password", async (req, reply) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "New password must be at least 8 characters" };
    }
    const userId = req.userId!;
    const { currentPassword, newPassword } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      reply.code(401);
      return { error: "Current password is incorrect" };
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    return { ok: true };
  });

  app.delete("/api/account/data", async (req, reply) => {
    const userId = req.userId!;

    const userPrograms = await db.select({ id: programs.id }).from(programs).where(eq(programs.userId, userId));
    for (const p of userPrograms) {
      await db.delete(programDays).where(eq(programDays.programId, p.id));
    }
    await db.delete(logs).where(eq(logs.userId, userId));
    await db.delete(favorites).where(eq(favorites.userId, userId));
    await db.delete(foodSearchStats).where(eq(foodSearchStats.userId, userId));
    await db.delete(programs).where(eq(programs.userId, userId));
    await db.delete(checkins).where(eq(checkins.userId, userId));
    await db.delete(goals).where(eq(goals.userId, userId));
    await db.delete(weights).where(eq(weights.userId, userId));
    await db.delete(photos).where(eq(photos.userId, userId));
    await db.delete(profiles).where(eq(profiles.userId, userId));

    await fs.promises.rm(path.join(dataDir, "photos", userId), { recursive: true, force: true });

    reply.code(204);
    return null;
  });
}
