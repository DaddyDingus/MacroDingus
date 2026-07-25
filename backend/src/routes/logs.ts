import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { logs, foods } from "../db/schema.js";
import { scaleNutrition, sumNutrition } from "../engine/nutrition.js";

const MEALS = ["breakfast", "lunch", "dinner", "snacks"] as const;

const logInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal: z.enum(MEALS),
  foodId: z.string(),
  quantityGrams: z.number().positive(),
  loggedAt: z.string().optional(),
});

async function entryWithNutrition(logId: string, userId: string) {
  const rows = await db
    .select({ log: logs, food: foods })
    .from(logs)
    .innerJoin(foods, eq(logs.foodId, foods.id))
    .where(and(eq(logs.id, logId), eq(logs.userId, userId)));
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.log.id,
    meal: row.log.meal,
    quantityGrams: row.log.quantityGrams,
    loggedAt: row.log.loggedAt,
    food: row.food,
    nutrition: scaleNutrition(row.food, row.log.quantityGrams),
  };
}

export function registerLogRoutes(app: FastifyInstance) {
  app.get("/api/logs", async (req, reply) => {
    const { date } = req.query as { date?: string };
    if (!date) return reply.code(400).send({ error: "date is required" });

    const rows = await db
      .select({ log: logs, food: foods })
      .from(logs)
      .innerJoin(foods, eq(logs.foodId, foods.id))
      .where(and(eq(logs.date, date), eq(logs.userId, req.userId!)));

    const entries = rows.map(({ log, food }) => ({
      id: log.id,
      meal: log.meal,
      quantityGrams: log.quantityGrams,
      loggedAt: log.loggedAt,
      food,
      nutrition: scaleNutrition(food, log.quantityGrams),
    }));

    const totals = sumNutrition(entries.map((e) => e.nutrition));
    return { date, entries, totals };
  });

  app.post("/api/logs", async (req, reply) => {
    const parsed = logInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [food] = await db.select().from(foods).where(eq(foods.id, parsed.data.foodId));
    if (!food) return reply.code(400).send({ error: "unknown foodId" });

    const id = randomUUID();
    const now = new Date().toISOString();
    await db.insert(logs).values({
      id,
      userId: req.userId!,
      date: parsed.data.date,
      meal: parsed.data.meal,
      foodId: parsed.data.foodId,
      quantityGrams: parsed.data.quantityGrams,
      loggedAt: parsed.data.loggedAt ?? now,
      createdAt: now,
    });

    reply.code(201);
    return entryWithNutrition(id, req.userId!);
  });

  app.patch("/api/logs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const patchSchema = z.object({
      quantityGrams: z.number().positive().optional(),
      meal: z.enum(MEALS).optional(),
    });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    await db
      .update(logs)
      .set(parsed.data)
      .where(and(eq(logs.id, id), eq(logs.userId, req.userId!)));
    const entry = await entryWithNutrition(id, req.userId!);
    if (!entry) return reply.code(404).send({ error: "not found" });
    return entry;
  });

  app.delete("/api/logs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(logs).where(and(eq(logs.id, id), eq(logs.userId, req.userId!)));
    reply.code(204);
    return null;
  });

  // Foods logged within +/-2h of the given time-of-day, ranked by frequency then
  // recency; falls back to "most recently logged, ever" when history is too sparse
  // (new install, or nothing has ever been logged around this hour before).
  app.get("/api/logs/smart-history", async (req) => {
    const { time, limit } = req.query as { time?: string; limit?: string };
    const take = Math.min(Number(limit) || 8, 20);
    const [hh] = (time ?? new Date().toISOString().slice(11, 16)).split(":");
    const hour = Number(hh);
    const userId = req.userId!;

    const windowRows = await db
      .select({ food: foods, cnt: sql<number>`count(*)` })
      .from(logs)
      .innerJoin(foods, eq(logs.foodId, foods.id))
      .where(
        and(
          eq(logs.userId, userId),
          sql`abs((cast(strftime('%H', ${logs.loggedAt}) as integer) - ${hour} + 12) % 24 - 12) <= 2`
        )
      )
      .groupBy(foods.id)
      .orderBy(sql`count(*) desc`, sql`max(${logs.loggedAt}) desc`)
      .limit(take);

    if (windowRows.length > 0) {
      return { basis: "time-of-day", foods: windowRows.map((r) => r.food) };
    }

    const recentRows = await db
      .select({ food: foods })
      .from(logs)
      .innerJoin(foods, eq(logs.foodId, foods.id))
      .where(eq(logs.userId, userId))
      .groupBy(foods.id)
      .orderBy(sql`max(${logs.loggedAt}) desc`)
      .limit(take);

    return { basis: "recent", foods: recentRows.map((r) => r.food) };
  });
}
