import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { logs, favorites, programDays, programs, checkins, goals, weights, photos, profiles } from "../db/schema.js";

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
  app.delete("/api/account/data", async (req, reply) => {
    const userId = req.userId!;

    const userPrograms = await db.select({ id: programs.id }).from(programs).where(eq(programs.userId, userId));
    for (const p of userPrograms) {
      await db.delete(programDays).where(eq(programDays.programId, p.id));
    }
    await db.delete(logs).where(eq(logs.userId, userId));
    await db.delete(favorites).where(eq(favorites.userId, userId));
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
