import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, gte, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { logs, foods, recipes, recipeIngredients } from "../db/schema.js";
import { scaleNutrition, sumNutrition, EMPTY_NUTRITION } from "../engine/nutrition.js";
import { addDaysToDateString } from "../engine/trendWeight.js";
import { householdDateString } from "../lib/householdDate.js";

const INGREDIENT_PREVIEW_LIMIT = 3;

// Attaches up to 3 {name, icon} ingredient previews onto recipe-sourced
// foods that have no custom icon of their own — RecipeIconStack renders
// these client-side as a collage instead of a single generic avatar. Mutates
// each entry's `food` object in place (adding `ingredientPreview`) rather
// than rebuilding the array, since callers already hold references into it.
// Icon *resolution* (emoji vs. letter-avatar fallback) stays purely
// client-side in lib/foodEmoji.ts — this just supplies the raw name/icon
// pairs the same way any other food is described.
async function attachIngredientPreviews(entries: { food: typeof foods.$inferSelect }[]) {
  const recipeFoodIds = [
    ...new Set(entries.filter((e) => e.food.source === "recipe" && !e.food.icon).map((e) => e.food.id)),
  ];
  if (recipeFoodIds.length === 0) return;

  const rows = await db
    .select({ recipeFoodId: recipes.foodId, name: foods.name, icon: foods.icon })
    .from(recipes)
    .innerJoin(recipeIngredients, eq(recipeIngredients.recipeId, recipes.id))
    .innerJoin(foods, eq(recipeIngredients.foodId, foods.id))
    .where(inArray(recipes.foodId, recipeFoodIds));

  const byFoodId = new Map<string, { name: string; icon: string | null }[]>();
  for (const row of rows) {
    const list = byFoodId.get(row.recipeFoodId) ?? [];
    if (list.length < INGREDIENT_PREVIEW_LIMIT) list.push({ name: row.name, icon: row.icon });
    byFoodId.set(row.recipeFoodId, list);
  }

  for (const entry of entries) {
    const preview = byFoodId.get(entry.food.id);
    if (preview) (entry.food as typeof entry.food & { ingredientPreview?: typeof preview }).ingredientPreview = preview;
  }
}

const logInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
      quantityGrams: log.quantityGrams,
      loggedAt: log.loggedAt,
      food,
      nutrition: scaleNutrition(food, log.quantityGrams),
    }));
    await attachIngredientPreviews(entries);

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
      foodId: parsed.data.foodId,
      quantityGrams: parsed.data.quantityGrams,
      loggedAt: parsed.data.loggedAt ?? now,
      createdAt: now,
    });

    reply.code(201);
    return entryWithNutrition(id, req.userId!);
  });

  // Adds several entries to one day in a single round-trip — backs the add-food
  // sheet's "select multiple, add them all" mode, where firing N individual
  // POST /api/logs requests would mean N separate optimistic-update races.
  app.post("/api/logs/bulk", async (req, reply) => {
    const schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      // Overrides the default "now" timestamp on every inserted row — used by
      // the Food Log's per-entry/per-group "copy to…" actions, which need
      // entries created under a specific target date/time rather than the
      // moment the request happened to fire.
      loggedAt: z.string().optional(),
      entries: z
        .array(
          z.object({
            foodId: z.string(),
            quantityGrams: z.number().positive(),
          })
        )
        .min(1)
        .max(50),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const foodIds = [...new Set(parsed.data.entries.map((e) => e.foodId))];
    const foundFoods = await db.select().from(foods).where(inArray(foods.id, foodIds));
    const foodMap = new Map(foundFoods.map((f) => [f.id, f]));
    if (foundFoods.length !== foodIds.length) return reply.code(400).send({ error: "unknown foodId" });

    const now = new Date().toISOString();
    const loggedAt = parsed.data.loggedAt ?? now;
    const rows = parsed.data.entries.map((e) => ({
      id: randomUUID(),
      userId: req.userId!,
      date: parsed.data.date,
      foodId: e.foodId,
      quantityGrams: e.quantityGrams,
      loggedAt,
      createdAt: now,
    }));
    await db.insert(logs).values(rows);

    reply.code(201);
    return {
      entries: rows.map((row) => {
        const food = foodMap.get(row.foodId)!;
        return {
          id: row.id,
          quantityGrams: row.quantityGrams,
          loggedAt: row.loggedAt,
          food,
          nutrition: scaleNutrition(food, row.quantityGrams),
        };
      }),
    };
  });

  // Copies every entry from one day to another — powers "copy a day."
  // Additive: existing entries on the target day are left alone, not replaced.
  app.post("/api/logs/copy", async (req, reply) => {
    const schema = z.object({
      sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { sourceDate, targetDate } = parsed.data;
    const userId = req.userId!;

    const sourceRows = await db
      .select()
      .from(logs)
      .where(and(eq(logs.userId, userId), eq(logs.date, sourceDate)));
    if (sourceRows.length === 0) return { copied: 0 };

    const now = new Date().toISOString();
    const newRows = sourceRows.map((row) => ({
      id: randomUUID(),
      userId,
      date: targetDate,
      foodId: row.foodId,
      quantityGrams: row.quantityGrams,
      loggedAt: now,
      createdAt: now,
    }));
    await db.insert(logs).values(newRows);

    return { copied: newRows.length };
  });

  // Full daily nutrition totals for every day in the range, including zero
  // days (not just days with entries) — a continuous series is what a chart
  // needs; gaps would read as missing data rather than "didn't log that day,"
  // which is neutral information, not an error state.
  app.get("/api/logs/history", async (req) => {
    const { days } = req.query as { days?: string };
    // Was capped at 365; raised to match the same large-N "All" pattern the
    // weight/checkin endpoints already use, once the Energy Balance screen's
    // own "All" range preset needed real multi-year depth rather than a
    // second option that silently behaved identically to "1Y". Still
    // trivial at personal-diary scale — same reasoning as GET /api/weights.
    const take = Math.min(Number(days) || 30, 3650);
    const userId = req.userId!;
    const today = householdDateString();
    const since = addDaysToDateString(today, -(take - 1));

    const rows = await db
      .select({ log: logs, food: foods })
      .from(logs)
      .innerJoin(foods, eq(logs.foodId, foods.id))
      .where(and(eq(logs.userId, userId), gte(logs.date, since)));

    const byDate = new Map<string, ReturnType<typeof sumNutrition>>();
    for (const { log, food } of rows) {
      const entryNutrition = scaleNutrition(food, log.quantityGrams);
      const existing = byDate.get(log.date) ?? EMPTY_NUTRITION;
      byDate.set(log.date, sumNutrition([existing, entryNutrition]));
    }

    const result = [];
    for (let i = 0; i < take; i++) {
      const date = addDaysToDateString(since, i);
      result.push({ date, ...(byDate.get(date) ?? EMPTY_NUTRITION) });
    }
    return result;
  });

  // Recent days that have at least one entry, most recent first, with a
  // calorie total per day so a copy-from picker reads as more than bare
  // dates. Aggregated in JS rather than SQL — trivial at personal-diary scale
  // and avoids fighting drizzle's query builder for a marginal gain.
  app.get("/api/logs/recent-days", async (req) => {
    const { limit } = req.query as { limit?: string };
    const take = Math.min(Number(limit) || 14, 60);
    const userId = req.userId!;

    const rows = await db
      .select({ log: logs, food: foods })
      .from(logs)
      .innerJoin(foods, eq(logs.foodId, foods.id))
      .where(eq(logs.userId, userId));

    const byDate = new Map<string, { calories: number; entryCount: number }>();
    for (const { log, food } of rows) {
      const calories = scaleNutrition(food, log.quantityGrams).calories;
      const existing = byDate.get(log.date) ?? { calories: 0, entryCount: 0 };
      existing.calories += calories;
      existing.entryCount += 1;
      byDate.set(log.date, existing);
    }

    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, take)
      .map(([date, v]) => ({ date, calories: Math.round(v.calories), entryCount: v.entryCount }));
  });

  // Just the distinct dates something was logged, full history — backs the
  // Habits logging-consistency calendar, which needs years of coverage, not
  // a days-capped window. Cheap: covered by logs_user_date_idx, and bounded
  // by how many distinct days the app's been used, not by entry count.
  app.get("/api/logs/logged-dates", async (req) => {
    const rows = await db
      .selectDistinct({ date: logs.date })
      .from(logs)
      .where(eq(logs.userId, req.userId!))
      .orderBy(logs.date);
    return { dates: rows.map((r) => r.date) };
  });

  app.patch("/api/logs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const patchSchema = z.object({
      quantityGrams: z.number().positive().optional(),
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

  // Moves one or more existing entries to a new date/time in place (as
  // opposed to /logs/bulk, which creates copies) — backs the Food Log's
  // per-entry/per-group "move to…" actions and "modify timestamp" (which
  // passes only loggedAt, leaving date untouched so the entry stays on the
  // same day). One codepath for both a single entry and a whole time-group.
  app.patch("/api/logs/bulk-move", async (req, reply) => {
    const schema = z.object({
      ids: z.array(z.string()).min(1).max(50),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      loggedAt: z.string(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { ids, date, loggedAt } = parsed.data;
    const userId = req.userId!;

    await db
      .update(logs)
      .set(date ? { date, loggedAt } : { loggedAt })
      .where(and(inArray(logs.id, ids), eq(logs.userId, userId)));

    const rows = await db
      .select({ log: logs, food: foods })
      .from(logs)
      .innerJoin(foods, eq(logs.foodId, foods.id))
      .where(and(inArray(logs.id, ids), eq(logs.userId, userId)));

    return {
      entries: rows.map(({ log, food }) => ({
        id: log.id,
        quantityGrams: log.quantityGrams,
        loggedAt: log.loggedAt,
        food,
        nutrition: scaleNutrition(food, log.quantityGrams),
      })),
    };
  });

  app.delete("/api/logs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(logs).where(and(eq(logs.id, id), eq(logs.userId, req.userId!)));
    reply.code(204);
    return null;
  });

  // Deletes one or more entries in one request — backs the Food Log's
  // group-selection "Delete" action (removing a whole time-group at once),
  // same ids-array shape as /logs/bulk-move above.
  app.delete("/api/logs/bulk", async (req, reply) => {
    const schema = z.object({ ids: z.array(z.string()).min(1).max(50) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    await db.delete(logs).where(and(inArray(logs.id, parsed.data.ids), eq(logs.userId, req.userId!)));
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
