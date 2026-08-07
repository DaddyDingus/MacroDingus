import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { dailyAdjustments } from "../db/schema.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const adjustmentInput = z.object({
  date: z.string().regex(DATE_RE),
  sourceDate: z.string().regex(DATE_RE),
  kcal: z.number().min(0).max(5000),
  proteinG: z.number().min(0).max(500),
  carbsG: z.number().min(0).max(500),
  fatG: z.number().min(0).max(500),
});

export function registerAdjustmentRoutes(app: FastifyInstance) {
  app.get("/api/adjustments/:date", async (req) => {
    const { date } = req.params as { date: string };
    const [row] = await db
      .select()
      .from(dailyAdjustments)
      .where(and(eq(dailyAdjustments.userId, req.userId!), eq(dailyAdjustments.date, date)));
    return row ?? null;
  });

  // Upsert: re-running "Carry Forward Shortfall" for a date replaces the
  // stored amount rather than stacking a second row — same one-row-per-date
  // pattern weights.ts uses for re-weighing the same day.
  app.post("/api/adjustments", async (req, reply) => {
    const parsed = adjustmentInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.userId!;

    const [existing] = await db
      .select()
      .from(dailyAdjustments)
      .where(and(eq(dailyAdjustments.userId, userId), eq(dailyAdjustments.date, parsed.data.date)));

    if (existing) {
      await db.update(dailyAdjustments).set(parsed.data).where(eq(dailyAdjustments.id, existing.id));
      const [updated] = await db.select().from(dailyAdjustments).where(eq(dailyAdjustments.id, existing.id));
      return updated;
    }

    const id = randomUUID();
    await db.insert(dailyAdjustments).values({
      id,
      userId,
      ...parsed.data,
      createdAt: new Date().toISOString(),
    });
    const [created] = await db.select().from(dailyAdjustments).where(eq(dailyAdjustments.id, id));
    reply.code(201);
    return created;
  });

  app.delete("/api/adjustments/:date", async (req, reply) => {
    const { date } = req.params as { date: string };
    await db
      .delete(dailyAdjustments)
      .where(and(eq(dailyAdjustments.userId, req.userId!), eq(dailyAdjustments.date, date)));
    reply.code(204);
    return null;
  });
}
