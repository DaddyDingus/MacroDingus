import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, gte, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { profiles, checkins, weights, logs, foods } from "../db/schema.js";
import { scaleNutrition } from "../engine/nutrition.js";
import { computeTrend, daysBetween, addDaysToDateString } from "../engine/trendWeight.js";
import { mifflinStJeorTdee, estimateAdaptiveTdee, computeMacroTargets } from "../engine/tdee.js";

const profileInput = z.object({
  sex: z.enum(["male", "female"]),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear() - 5),
  heightCm: z.number().positive().max(300),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  goalType: z.enum(["cut", "bulk", "maintain"]),
  targetRateKgPerWeek: z.number().min(-2).max(2),
  proteinPerKg: z.number().min(0.5).max(4).default(2.0),
  fatPercent: z.number().min(0.1).max(0.6).default(0.25),
  goalWeightKg: z.number().positive().max(500).nullable(),
});

const CALORIE_LOOKBACK_DAYS = 21; // window for adaptive TDEE (needs 14 days of overlap; pad a bit for logging gaps

async function currentTrendKg(userId: string): Promise<number | null> {
  const weighIns = await db.select().from(weights).where(eq(weights.userId, userId)).orderBy(weights.date);
  if (weighIns.length === 0) return null;
  const trend = computeTrend(weighIns.map((w) => ({ date: w.date, weightKg: w.weightKg })));
  return trend[trend.length - 1].trendKg;
}

// Shared by the manual "check in" action and by saving/editing a profile —
// both should produce fresh targets immediately, not wait for a separately
// triggered recompute.
async function performCheckin(userId: string) {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!profile) return { error: "profile_required" as const };

  const weighIns = await db.select().from(weights).where(eq(weights.userId, userId)).orderBy(weights.date);
  if (weighIns.length === 0) return { error: "weight_required" as const };

  const trend = computeTrend(weighIns.map((w) => ({ date: w.date, weightKg: w.weightKg })));
  const trendWeightKg = trend[trend.length - 1].trendKg;

  const today = new Date().toISOString().slice(0, 10);
  const cutoff = addDaysToDateString(today, -CALORIE_LOOKBACK_DAYS);
  const logRows = await db
    .select({ log: logs, food: foods })
    .from(logs)
    .innerJoin(foods, eq(logs.foodId, foods.id))
    .where(and(eq(logs.userId, userId), gte(logs.date, cutoff)));

  const caloriesByDate = new Map<string, number>();
  for (const { log, food } of logRows) {
    const calories = scaleNutrition(food, log.quantityGrams).calories;
    caloriesByDate.set(log.date, (caloriesByDate.get(log.date) ?? 0) + calories);
  }
  const dailyCalories = [...caloriesByDate.entries()].map(([date, calories]) => ({ date, calories }));

  const adaptiveTdee = estimateAdaptiveTdee(
    weighIns.map((w) => ({ date: w.date, weightKg: w.weightKg })),
    dailyCalories
  );
  const age = new Date().getFullYear() - profile.birthYear;
  const formulaTdee = mifflinStJeorTdee({
    sex: profile.sex as "male" | "female",
    age,
    heightCm: profile.heightCm,
    weightKg: trendWeightKg,
    activityLevel: profile.activityLevel,
  });
  const tdee = adaptiveTdee ?? formulaTdee;

  const targetCalories = tdee + (profile.targetRateKgPerWeek * 7700) / 7;
  const macros = computeMacroTargets(targetCalories, trendWeightKg, profile.proteinPerKg, profile.fatPercent);

  const id = randomUUID();
  await db.insert(checkins).values({
    id,
    userId,
    date: today,
    tdee: Math.round(tdee),
    targetCalories: macros.calories,
    targetProteinG: macros.proteinG,
    targetCarbsG: macros.carbsG,
    targetFatG: macros.fatG,
    trendWeightKg,
    createdAt: new Date().toISOString(),
  });

  const [checkin] = await db.select().from(checkins).where(eq(checkins.id, id));
  return { checkin, usedAdaptiveTdee: adaptiveTdee !== null };
}

export function registerCoachRoutes(app: FastifyInstance) {
  app.get("/api/profile", async (req) => {
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, req.userId!));
    return profile ?? null;
  });

  app.post("/api/profile", async (req, reply) => {
    const parsed = profileInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.userId!;
    const now = new Date().toISOString();

    const [existing] = await db.select().from(profiles).where(eq(profiles.userId, userId));

    // Goal Progress needs a stable "start" snapshot for the *current* goal
    // weight — re-snapshot only when goalWeightKg actually changes (including
    // being newly set or cleared), not on every unrelated profile edit, so
    // "% progress" stays relative to the goal actually in effect rather than
    // drifting every time activity level or macro split is tweaked.
    const previousGoalWeightKg = existing?.goalWeightKg ?? null;
    const goalWeightChanged = parsed.data.goalWeightKg !== previousGoalWeightKg;
    const goalSnapshot = !goalWeightChanged
      ? {}
      : parsed.data.goalWeightKg == null
        ? { goalStartedAt: null, goalStartWeightKg: null }
        : { goalStartedAt: now, goalStartWeightKg: await currentTrendKg(userId) };

    if (existing) {
      await db.update(profiles).set({ ...parsed.data, ...goalSnapshot, updatedAt: now }).where(eq(profiles.userId, userId));
    } else {
      await db.insert(profiles).values({ userId, ...parsed.data, ...goalSnapshot, createdAt: now, updatedAt: now });
    }

    const result = await performCheckin(userId);
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    return { profile, ...result };
  });

  app.post("/api/checkins", async (req, reply) => {
    const result = await performCheckin(req.userId!);
    if ("error" in result) {
      reply.code(400);
      return { error: result.error === "profile_required" ? "Set up your profile first" : "Log at least one weight first" };
    }
    reply.code(201);
    return result;
  });

  app.get("/api/checkins", async (req) => {
    return db.select().from(checkins).where(eq(checkins.userId, req.userId!)).orderBy(desc(checkins.date));
  });

  app.get("/api/coach/status", async (req) => {
    const userId = req.userId!;
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    const [latestCheckin] = await db
      .select()
      .from(checkins)
      .where(eq(checkins.userId, userId))
      .orderBy(desc(checkins.date))
      .limit(1);
    const trendWeightKg = await currentTrendKg(userId);

    return {
      profile: profile ?? null,
      latestCheckin: latestCheckin ?? null,
      trendWeightKg,
      daysSinceCheckin: latestCheckin ? daysBetween(latestCheckin.date, new Date().toISOString().slice(0, 10)) : null,
    };
  });
}
