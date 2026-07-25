import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, gte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { weights } from "../db/schema.js";
import { computeTrend, addDaysToDateString } from "../engine/trendWeight.js";

const weightInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weightKg: z.number().positive().max(500),
});

export function registerWeightRoutes(app: FastifyInstance) {
  // Upsert: re-weighing on a day you've already logged corrects that day's
  // reading rather than creating a second entry — there's only ever one
  // scale weight per person per day.
  app.post("/api/weights", async (req, reply) => {
    const parsed = weightInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.userId!;

    const [existing] = await db
      .select()
      .from(weights)
      .where(and(eq(weights.userId, userId), eq(weights.date, parsed.data.date)));

    if (existing) {
      await db.update(weights).set({ weightKg: parsed.data.weightKg }).where(eq(weights.id, existing.id));
      const [updated] = await db.select().from(weights).where(eq(weights.id, existing.id));
      return updated;
    }

    const id = randomUUID();
    await db.insert(weights).values({
      id,
      userId,
      date: parsed.data.date,
      weightKg: parsed.data.weightKg,
      createdAt: new Date().toISOString(),
    });
    const [created] = await db.select().from(weights).where(eq(weights.id, id));
    reply.code(201);
    return created;
  });

  app.get("/api/weights", async (req) => {
    const { days } = req.query as { days?: string };
    const userId = req.userId!;
    const take = Math.min(Number(days) || 90, 3650);
    const since = addDaysToDateString(new Date().toISOString().slice(0, 10), -take);

    return db
      .select()
      .from(weights)
      .where(and(eq(weights.userId, userId), gte(weights.date, since)))
      .orderBy(weights.date);
  });

  // Trend weight is computed from the FULL history every time, not just the
  // requested window — otherwise the EWMA would restart cold at the window
  // boundary and understate how settled the trend actually is. Only the
  // response is sliced to the requested range.
  app.get("/api/weights/trend", async (req) => {
    const { days } = req.query as { days?: string };
    const userId = req.userId!;
    const take = Math.min(Number(days) || 90, 3650);

    const all = await db.select().from(weights).where(eq(weights.userId, userId)).orderBy(weights.date);
    const trend = computeTrend(all.map((w) => ({ date: w.date, weightKg: w.weightKg })));

    const since = addDaysToDateString(new Date().toISOString().slice(0, 10), -take);
    return trend.filter((t) => t.date >= since);
  });

  app.delete("/api/weights/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(weights).where(and(eq(weights.id, id), eq(weights.userId, req.userId!)));
    reply.code(204);
    return null;
  });
}
