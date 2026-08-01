import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { goals, checkins, programs, programDays } from "../db/schema.js";
import { currentTrendKg } from "./shared.js";
import { performCheckin } from "./coach.js";

const goalInput = z.object({
  goalType: z.enum(["cut", "bulk", "maintain"]),
  goalWeightKg: z.number().positive().max(500).nullable(),
  targetRateKgPerWeek: z.number().min(-2).max(2),
});

const goalEditInput = z.object({
  goalWeightKg: z.number().positive().max(500).nullable(),
  targetRateKgPerWeek: z.number().min(-2).max(2),
});

export function registerGoalRoutes(app: FastifyInstance) {
  app.get("/api/goals", async (req) => {
    return db.select().from(goals).where(eq(goals.userId, req.userId!)).orderBy(desc(goals.startedAt));
  });

  // Closes out whichever goal is currently active (at most one active goal
  // per user — endedAt === null) before inserting the new one. startWeightKg
  // snapshots trend weight now, same role profiles.goalStartWeightKg used to
  // play, so Goal Progress stays relative to the goal actually in effect.
  app.post("/api/goals", async (req, reply) => {
    const parsed = goalInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.userId!;
    const now = new Date().toISOString();

    // Only on a user's very first-ever goal (no checkin history at all) —
    // not every new goal an established user creates, which would silently
    // reset their weekly cadence anchor without them asking for it. This is
    // what starts the weekly check-in clock immediately on setup, instead
    // of leaving the very first check-in manually triggerable at any time
    // (which defeats the weekly restriction for exactly the one check-in
    // that matters most for establishing a real baseline).
    const [{ count: priorCheckins }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(checkins)
      .where(eq(checkins.userId, userId));

    await db.update(goals).set({ endedAt: now }).where(and(eq(goals.userId, userId), isNull(goals.endedAt)));

    const id = randomUUID();
    await db.insert(goals).values({
      id,
      userId,
      goalType: parsed.data.goalType,
      goalWeightKg: parsed.data.goalWeightKg,
      targetRateKgPerWeek: parsed.data.targetRateKgPerWeek,
      startedAt: now,
      startWeightKg: await currentTrendKg(userId),
      createdAt: now,
    });

    if (priorCheckins === 0) {
      await performCheckin(userId); // best-effort — e.g. no-ops via its own weight_required error if no weigh-in exists yet
    }

    const [goal] = await db.select().from(goals).where(eq(goals.id, id));
    reply.code(201);
    return goal;
  });

  // True in-place edit, not a new history row — matches "Edits to your
  // goal" showing a before/after diff on the *same* goal. Only the active
  // goal is editable; a past goal must be reopened first.
  app.patch("/api/goals/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = goalEditInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.userId!;

    const [existing] = await db.select().from(goals).where(and(eq(goals.id, id), eq(goals.userId, userId)));
    if (!existing) return reply.code(404).send({ error: "Goal not found" });
    if (existing.endedAt !== null) return reply.code(400).send({ error: "Only the active goal can be edited" });

    await db
      .update(goals)
      .set({ goalWeightKg: parsed.data.goalWeightKg, targetRateKgPerWeek: parsed.data.targetRateKgPerWeek })
      .where(eq(goals.id, id));

    const [updated] = await db.select().from(goals).where(eq(goals.id, id));
    return updated;
  });

  // History cleanup only — the active goal can't be deleted this way (it
  // would leave the app's onboarding gate and Strategy tab with nothing to
  // show; ending a goal only ever happens by superseding it with a new one,
  // see POST above). Cascades to that goal's program(s) and their
  // program_days first: programs.goalId is a NOT NULL FK with foreign_keys
  // pragma ON, so deleting a goal with a program still attached would
  // otherwise fail outright — and since almost every real goal has one, a
  // "history" delete that only worked for goals nobody ever built a program
  // for wouldn't be much of a feature.
  app.delete("/api/goals/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.userId!;

    const [existing] = await db.select().from(goals).where(and(eq(goals.id, id), eq(goals.userId, userId)));
    if (!existing) return reply.code(404).send({ error: "Goal not found" });
    if (existing.endedAt === null) return reply.code(400).send({ error: "Can't delete the active goal" });

    const goalPrograms = await db.select({ id: programs.id }).from(programs).where(eq(programs.goalId, id));
    for (const p of goalPrograms) {
      await db.delete(programDays).where(eq(programDays.programId, p.id));
    }
    await db.delete(programs).where(eq(programs.goalId, id));
    await db.delete(goals).where(eq(goals.id, id));

    reply.code(204);
    return null;
  });

  app.post("/api/goals/:id/reopen", async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.userId!;
    const now = new Date().toISOString();

    const [target] = await db.select().from(goals).where(and(eq(goals.id, id), eq(goals.userId, userId)));
    if (!target) return reply.code(404).send({ error: "Goal not found" });

    await db.update(goals).set({ endedAt: now }).where(and(eq(goals.userId, userId), isNull(goals.endedAt)));
    await db.update(goals).set({ endedAt: null }).where(eq(goals.id, id));

    const [reopened] = await db.select().from(goals).where(eq(goals.id, id));
    return reopened;
  });
}
