import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { profiles, checkins, goals, programs, programDays } from "../db/schema.js";
import { computeTrend, daysBetween, addDaysToDateString } from "../engine/trendWeight.js";
import { macroFactorTdee, estimateAdaptiveTdee } from "../engine/tdee.js";
import { generateCoachedProgramDays, type DietType, type ProteinLevel } from "../engine/program.js";
import { generateCheckinNarrative } from "../engine/checkinNarrative.js";
import { anthropicKeyStatus } from "../engine/anthropicClient.js";
import {
  currentTrendKg,
  gatherAdaptiveTdeeInputs,
  gatherDailyTdeeSeriesInputs,
  mostRecentBodyFatPercent,
  parseShiftedHighDays,
  serializeProgram,
} from "./shared.js";
import { nextCheckinDueDate } from "../lib/checkinSchedule.js";

// Body-stat fields only — goal/program fields moved to /api/goals and
// /api/programs (see schema.ts's Phase 1/Phase 2 migration notes).
// checkInDayOfWeek is the only genuinely new field here.
const profileInput = z.object({
  sex: z.enum(["male", "female"]),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear() - 5),
  heightCm: z.number().positive().max(300),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  checkInDayOfWeek: z.number().int().min(0).max(6).nullable(),
  weeklyExerciseHours: z.number().min(0).max(168).nullable().optional(),
});

async function activeProgramForUser(userId: string) {
  const [program] = await db
    .select()
    .from(programs)
    .where(and(eq(programs.userId, userId), isNull(programs.endedAt)));
  return program ?? null;
}

async function latestCheckinForUser(userId: string) {
  const [checkin] = await db.select().from(checkins).where(eq(checkins.userId, userId)).orderBy(desc(checkins.date)).limit(1);
  return checkin ?? null;
}

// A check-in's real job now is just refreshing the TDEE estimate. If the
// active program is Coached and hasn't been hand-customized ('custom'),
// its program_days are also refreshed to reflect the fresh TDEE — matches
// the Goal Rate copy's "we will adjust your calorie targets as needed".
// Manual programs and hand-edited ones are never touched by a check-in.
export async function performCheckin(userId: string) {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!profile) return { error: "profile_required" as const };

  // Weekly cadence, enforced server-side (not just a UI hint) — checking in
  // more often doesn't add real signal (the 21-day adaptive-TDEE window and
  // the trend-weight EWMA are both already smoothing day-to-day noise out),
  // and a Coached program's targets would otherwise jitter on every check-in.
  const latestCheckin = await latestCheckinForUser(userId);
  const today = new Date().toISOString().slice(0, 10);
  if (latestCheckin) {
    const dueDate = nextCheckinDueDate(latestCheckin.date, profile.checkInDayOfWeek);
    if (today < dueDate) return { error: "checkin_not_due" as const, dueDate };
  }

  const { weighIns, dailyCalories } = await gatherAdaptiveTdeeInputs(userId);
  if (weighIns.length === 0) return { error: "weight_required" as const };

  const trend = computeTrend(weighIns);
  const trendWeightKg = trend[trend.length - 1].trendKg;
  const peakWeightKg = Math.max(...weighIns.map((w) => w.weightKg));

  const activeProgram = await activeProgramForUser(userId);
  const activeGoal = activeProgram
    ? (await db.select().from(goals).where(eq(goals.id, activeProgram.goalId)))[0] ?? null
    : null;
  const bodyFatPercent = await mostRecentBodyFatPercent(userId);

  const adaptiveTdee = estimateAdaptiveTdee(weighIns, dailyCalories);
  const age = new Date().getFullYear() - profile.birthYear;
  const formulaTdee = macroFactorTdee({
    sex: profile.sex as "male" | "female",
    age,
    heightCm: profile.heightCm,
    weightKg: trendWeightKg,
    activityLevel: profile.activityLevel,
    bodyFatPercent,
    weeklyExerciseHours: profile.weeklyExerciseHours,
    inDeficit: activeGoal != null && activeGoal.targetRateKgPerWeek < 0,
    peakWeightKg,
  });
  const tdee = adaptiveTdee?.tdee ?? formulaTdee;
  if (activeProgram && activeProgram.style === "coached" && activeProgram.distributionMode !== "custom" && activeGoal) {
    {
      const result = generateCoachedProgramDays({
        weighIns,
        dailyCalories,
        sex: profile.sex as "male" | "female",
        age,
        heightCm: profile.heightCm,
        activityLevel: profile.activityLevel,
        targetRateKgPerWeek: activeGoal.targetRateKgPerWeek,
        dietType: activeProgram.dietType as DietType,
        proteinLevel: activeProgram.proteinLevel as ProteinLevel,
        // Same lookup as programs.ts's own regenerate — re-derives from what
        // was resolved at creation time, not re-asked here.
        customProteinPerKg: activeProgram.proteinLevel === "custom" ? (activeProgram.proteinPerKgUsed ?? undefined) : undefined,
        initialTdeeOverrideKcal: activeProgram.initialTdeeOverrideKcal,
        calorieFloorKcal: activeProgram.calorieFloorKcal!,
        distributionMode: activeProgram.distributionMode as "even" | "shifted",
        shiftedHighDays: parseShiftedHighDays(activeProgram.shiftedHighDays),
        proteinBasis: activeProgram.proteinBasis as "total" | "lean",
        bodyFatPercent,
        weeklyExerciseHours: profile.weeklyExerciseHours ?? null,
      });
      for (const day of result.days) {
        await db
          .update(programDays)
          .set({
            targetCalories: day.targetCalories,
            targetProteinG: day.targetProteinG,
            targetCarbsG: day.targetCarbsG,
            targetFatG: day.targetFatG,
          })
          .where(and(eq(programDays.programId, activeProgram.id), eq(programDays.dayOfWeek, day.dayOfWeek)));
      }
      await db
        .update(programs)
        .set({
          proteinPerKgUsed: result.breakdown.proteinPerKgUsed,
          proteinBasis: result.breakdown.proteinBasisUsed,
        })
        .where(eq(programs.id, activeProgram.id));
    }
  }

  // Best-effort — a narrative failure (no API key, a transient API error)
  // must never block the check-in itself, which is why this is generated
  // and swallowed here rather than left to the route handler: everything
  // else in performCheckin() is the real check-in logic, this is additive.
  let narrative: string | null = null;
  if (anthropicKeyStatus(userId).configured) {
    try {
      const windowStart = latestCheckin ? addDaysToDateString(latestCheckin.date, 1) : addDaysToDateString(today, -6);
      const windowDays = latestCheckin ? Math.max(1, daysBetween(latestCheckin.date, today)) : 7;
      const inWindow = dailyCalories.filter((d) => d.date >= windowStart && d.date <= today);
      const avgCaloriesInWindow = inWindow.length > 0 ? inWindow.reduce((s, d) => s + d.calories, 0) / inWindow.length : null;
      narrative = await generateCheckinNarrative(userId, {
        isFirstCheckin: latestCheckin == null,
        windowDays,
        loggedDays: inWindow.length,
        trendWeightKg,
        previousTrendWeightKg: latestCheckin?.trendWeightKg ?? null,
        tdee: Math.round(tdee),
        previousTdee: latestCheckin?.tdee ?? null,
        usedAdaptiveTdee: adaptiveTdee !== null,
        avgCaloriesInWindow,
      });
    } catch (err) {
      console.error("checkin narrative generation failed:", err);
    }
  }

  const id = randomUUID();
  await db.insert(checkins).values({
    id,
    userId,
    date: today,
    tdee: Math.round(tdee),
    trendWeightKg,
    usedAdaptiveTdee: adaptiveTdee !== null,
    tdeeFluxKcal: adaptiveTdee ? Math.round(adaptiveTdee.fluxKcal) : null,
    narrative,
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

    if (existing) {
      await db.update(profiles).set({ ...parsed.data, updatedAt: now }).where(eq(profiles.userId, userId));
    } else {
      await db.insert(profiles).values({ userId, ...parsed.data, createdAt: now, updatedAt: now });
    }

    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    return { profile };
  });

  // Lets OnboardingFlow's "Skip for now" on the weight step finish onboarding
  // without a goal — the app is fully safe with activeGoal === null
  // (Dashboard's own "Set a goal" card is the permanent reminder), so
  // there's no reason to force the Goal wizard on someone who has no weight
  // yet to build a real goal/program around. Same guarded stamp as
  // POST /api/goals (routes/goals.ts) — whichever happens first wins, the
  // other is a no-op.
  app.post("/api/profile/complete-onboarding", async (req, reply) => {
    const userId = req.userId!;
    const now = new Date().toISOString();

    await db
      .update(profiles)
      .set({ onboardingCompletedAt: now })
      .where(and(eq(profiles.userId, userId), isNull(profiles.onboardingCompletedAt)));

    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    if (!profile) return reply.code(404).send({ error: "Profile not found" });
    return { profile };
  });

  app.post("/api/checkins", async (req, reply) => {
    const result = await performCheckin(req.userId!);
    if ("error" in result) {
      reply.code(400);
      if (result.error === "checkin_not_due") {
        return { error: `Your next check-in isn't due until ${result.dueDate}.`, dueDate: result.dueDate };
      }
      return { error: result.error === "profile_required" ? "Set up your profile first" : "Log at least one weight first" };
    }
    reply.code(201);
    return result;
  });

  app.get("/api/checkins", async (req) => {
    return db.select().from(checkins).where(eq(checkins.userId, req.userId!)).orderBy(desc(checkins.date));
  });

  // Re-runs estimateAdaptiveTdee() as-of every day in the window, not just at
  // check-in time — a check-in only happens weekly, so most days have no
  // real TDEE/flux value of their own; this backfills one, using exactly the
  // same "gap when the data's insufficient, never fabricate" rule that
  // performCheckin() already applies (see engine/tdee.ts's AdaptiveTdeeEstimate
  // doc comment). Feeds both the Expenditure chart's Flux Range band and the
  // daily history list — days where the adaptive criteria aren't met (< 2
  // weigh-ins, < 50% calorie coverage in the trailing 21 days) are simply
  // omitted, not filled with a formula estimate that would have no real
  // variance to show anyway.
  app.get("/api/coach/expenditure-daily", async (req) => {
    const { days } = req.query as { days?: string };
    const take = Math.min(Number(days) || 30, 3650); // same cap convention as GET /api/logs/history
    const userId = req.userId!;
    const today = new Date().toISOString().slice(0, 10);
    const since = addDaysToDateString(today, -(take - 1));

    const { weighIns, dailyCalories } = await gatherDailyTdeeSeriesInputs(userId, take);

    const points: { date: string; tdee: number; fluxKcal: number }[] = [];
    let date = since;
    while (date <= today) {
      const weighInsUpToDate = weighIns.filter((w) => w.date <= date);
      const est = estimateAdaptiveTdee(weighInsUpToDate, dailyCalories);
      if (est) points.push({ date, tdee: Math.round(est.tdee), fluxKcal: Math.round(est.fluxKcal) });
      date = addDaysToDateString(date, 1);
    }
    return points;
  });

  app.get("/api/coach/status", async (req) => {
    const userId = req.userId!;
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    const latestCheckin = await latestCheckinForUser(userId);
    const trendWeightKg = await currentTrendKg(userId);
    const bodyFatPercent = await mostRecentBodyFatPercent(userId);
    const nextCheckinDue = latestCheckin && profile ? nextCheckinDueDate(latestCheckin.date, profile.checkInDayOfWeek) : null;

    const [activeGoal] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.userId, userId), isNull(goals.endedAt)));
    const activeProgram = await activeProgramForUser(userId);
    const activeProgramDays = activeProgram
      ? await db.select().from(programDays).where(eq(programDays.programId, activeProgram.id)).orderBy(programDays.dayOfWeek)
      : [];

    return {
      profile: profile ?? null,
      latestCheckin: latestCheckin ?? null,
      trendWeightKg,
      bodyFatPercent,
      daysSinceCheckin: latestCheckin ? daysBetween(latestCheckin.date, new Date().toISOString().slice(0, 10)) : null,
      nextCheckinDueDate: nextCheckinDue,
      activeGoal: activeGoal ?? null,
      activeProgram: activeProgram ? { ...serializeProgram(activeProgram), days: activeProgramDays } : null,
    };
  });
}
