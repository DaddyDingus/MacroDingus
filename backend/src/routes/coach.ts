import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { profiles, checkins, goals, programs, programDays } from "../db/schema.js";
import { computeTrend, daysBetween, addDaysToDateString } from "../engine/trendWeight.js";
import { macroFactorTdee, estimateAdaptiveTdee, adaptiveTdeeCoverage } from "../engine/tdee.js";
import { generateCoachedProgramDays, type DietType, type ProteinLevel } from "../engine/program.js";
import { generateCheckinNarrative, type CheckinNarrativeInput } from "../engine/checkinNarrative.js";
import {
  currentTrendKg,
  goalRateKgPerWeek,
  gatherAdaptiveTdeeInputs,
  gatherDailyTdeeSeriesInputs,
  mostRecentBodyFatPercent,
  parseShiftedHighDays,
  serializeGoal,
  serializeProgram,
} from "./shared.js";
import { nextCheckinDueDate } from "../lib/checkinSchedule.js";
import { householdDateString } from "../lib/householdDate.js";

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

// Identifies which check-in cycle an "ignore" applies to. The due date is
// the natural key — it only moves when a check-in actually happens, so an
// ignore survives exactly as long as the check-in it dismissed is pending,
// and a fresh cycle re-arms the reminders on its own. "initial" stands in
// for the pre-first-check-in state, which has no due date of its own.
function checkinCycleKey(nextDueDate: string | null): string {
  return nextDueDate ?? "initial";
}

// What a check-in did to the active program's daily targets. Averaged across
// the 7 program_days rows rather than reported per weekday: for an 'even'
// distribution every day is identical anyway, and for 'shifted' the weekly
// average is the number the program is actually built around. Null whenever
// the check-in didn't touch targets (manual program, hand-edited days, or
// no program at all) — there's no change to show, not a change of zero.
export interface CheckinTargetChanges {
  calories: { from: number; to: number };
  proteinG: { from: number; to: number };
  carbsG: { from: number; to: number };
  fatG: { from: number; to: number };
  // How far below measured expenditure the new targets sit, and whether that
  // is past DEEP_DEFICIT_FRACTION (see engine/program.ts). Advisory: the
  // targets deliver the goal's rate either way. Rides along with the change
  // being accepted because this is where the user can act on it — the
  // check-in is the moment the deficit's depth is knowable, since it is the
  // moment expenditure was re-measured.
  deficitFraction: number;
  deepDeficit: boolean;
  // What this program's new average target actually implies, in kg/week.
  // Differs from the goal's own rate only when the absolute calorie floor
  // bound.
  effectiveRateKgPerWeek: number;
}

// Named rather than returned as bare object literals: TypeScript normalizes a
// union of literal returns so every member carries every key (as `?: undefined`),
// which quietly defeats `"error" in result` narrowing at the call sites.
type CheckinRefusal =
  | { error: "profile_required" }
  | { error: "weight_required" }
  | { error: "checkin_not_due"; dueDate: string };

function refuse(refusal: CheckinRefusal): CheckinRefusal {
  return refusal;
}

function averageDayTargets(days: { targetCalories: number; targetProteinG: number; targetCarbsG: number; targetFatG: number }[]) {
  const n = days.length;
  const sum = (pick: (d: (typeof days)[number]) => number) => days.reduce((s, d) => s + pick(d), 0);
  return {
    calories: Math.round(sum((d) => d.targetCalories) / n),
    proteinG: Math.round(sum((d) => d.targetProteinG) / n),
    carbsG: Math.round(sum((d) => d.targetCarbsG) / n),
    fatG: Math.round(sum((d) => d.targetFatG) / n),
  };
}

// Everything a check-in would do, computed and returned without writing a
// single row. Split out from performCheckin() so the check-in screen can show
// you the new targets *before* they're yours (see POST /api/checkins/preview)
// — the whole accept/decline flow rests on this staying side-effect-free, so
// don't reach for db.insert/db.update in here.
//
// Deliberately excluded: the narrative. It's a paid gateway call, and nothing
// in the preview displays it, so generating one per preview would bill for
// text nobody reads and produce a second one on accept anyway.
//
// A check-in's real job is refreshing the TDEE estimate. If the active program
// is Coached and hasn't been hand-customized ('custom'), its program_days are
// also refreshed to reflect the fresh TDEE — matches the Goal Rate copy's "we
// will adjust your calorie targets as needed". Manual programs and hand-edited
// ones are never touched by a check-in.
export async function planCheckin(userId: string) {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  if (!profile) return refuse({ error: "profile_required" });

  // Weekly cadence, enforced server-side (not just a UI hint) — checking in
  // more often doesn't add real signal (the 21-day adaptive-TDEE window and
  // the trend-weight EWMA are both already smoothing day-to-day noise out),
  // and a Coached program's targets would otherwise jitter on every check-in.
  const latestCheckin = await latestCheckinForUser(userId);
  const today = householdDateString();
  if (latestCheckin) {
    const dueDate = nextCheckinDueDate(latestCheckin.date, profile.checkInDayOfWeek);
    if (today < dueDate) return refuse({ error: "checkin_not_due", dueDate });
  }

  const { weighIns, dailyCalories, dailyProtein } = await gatherAdaptiveTdeeInputs(userId);
  if (weighIns.length === 0) return refuse({ error: "weight_required" });

  const trend = computeTrend(weighIns);
  const trendWeightKg = trend[trend.length - 1].trendKg;
  const peakWeightKg = Math.max(...weighIns.map((w) => w.weightKg));

  const activeProgram = await activeProgramForUser(userId);
  const activeGoal = activeProgram
    ? (await db.select().from(goals).where(eq(goals.id, activeProgram.goalId)))[0] ?? null
    : null;
  const bodyFatPercent = await mostRecentBodyFatPercent(userId);

  // Read before anything regenerates: program_days isn't versioned and the
  // accept path overwrites these rows in place, so this is the only record of
  // the targets that were actually in force during the cycle just gone — which
  // is what the narrative compares logged intake against.
  const currentDays = activeProgram
    ? await db.select().from(programDays).where(eq(programDays.programId, activeProgram.id))
    : [];
  const currentTargets = currentDays.length > 0 ? averageDayTargets(currentDays) : null;
  const currentTargetCalories = currentTargets?.calories ?? null;
  const currentTargetProteinG = currentTargets?.proteinG ?? null;

  const adaptiveTdee = estimateAdaptiveTdee(weighIns, dailyCalories);
  const age = new Date().getFullYear() - profile.birthYear;
  const resolvedGoalRateKgPerWeek = activeGoal ? goalRateKgPerWeek(activeGoal, trendWeightKg) : 0;
  const formulaTdee = macroFactorTdee({
    sex: profile.sex as "male" | "female",
    age,
    heightCm: profile.heightCm,
    weightKg: trendWeightKg,
    activityLevel: profile.activityLevel,
    bodyFatPercent,
    weeklyExerciseHours: profile.weeklyExerciseHours,
    inDeficit: resolvedGoalRateKgPerWeek < 0,
    peakWeightKg,
  });
  const tdee = adaptiveTdee?.tdee ?? formulaTdee;
  let targetChanges: CheckinTargetChanges | null = null;
  let regenerate: {
    programId: string;
    days: { dayOfWeek: number; targetCalories: number; targetProteinG: number; targetCarbsG: number; targetFatG: number }[];
    proteinPerKgUsed: number;
    proteinBasisUsed: "total" | "lean";
  } | null = null;
  if (activeProgram && activeProgram.style === "coached" && activeProgram.distributionMode !== "custom" && activeGoal) {
    {
      const result = generateCoachedProgramDays({
        weighIns,
        dailyCalories,
        sex: profile.sex as "male" | "female",
        age,
        heightCm: profile.heightCm,
        activityLevel: profile.activityLevel,
        targetRateKgPerWeek: resolvedGoalRateKgPerWeek,
        dietType: activeProgram.dietType as DietType,
        proteinLevel: activeProgram.proteinLevel as ProteinLevel,
        // Same lookup as programs.ts's own regenerate — re-derives from what
        // was resolved at creation time, not re-asked here.
        customProteinPerKg: activeProgram.proteinLevel === "custom" ? (activeProgram.proteinPerKgUsed ?? undefined) : undefined,
        resolvedProteinPerKg: activeProgram.proteinPerKgUsed ?? undefined,
        proteinTargetGOverride: currentTargets?.proteinG,
        initialTdeeOverrideKcal: activeProgram.initialTdeeOverrideKcal,
        calorieFloorKcal: activeProgram.calorieFloorKcal!,
        distributionMode: activeProgram.distributionMode as "even" | "shifted",
        shiftedHighDays: parseShiftedHighDays(activeProgram.shiftedHighDays),
        proteinBasis: activeProgram.proteinBasis as "total" | "lean",
        bodyFatPercent,
        weeklyExerciseHours: profile.weeklyExerciseHours ?? null,
      });
      regenerate = {
        programId: activeProgram.id,
        days: result.days,
        proteinPerKgUsed: result.breakdown.proteinPerKgUsed,
        proteinBasisUsed: result.breakdown.proteinBasisUsed,
      };

      if (currentDays.length > 0) {
        const before = averageDayTargets(currentDays);
        const after = averageDayTargets(result.days);
        targetChanges = {
          calories: { from: before.calories, to: after.calories },
          proteinG: { from: before.proteinG, to: after.proteinG },
          carbsG: { from: before.carbsG, to: after.carbsG },
          fatG: { from: before.fatG, to: after.fatG },
          deficitFraction: result.breakdown.deficitFraction,
          deepDeficit: result.breakdown.deepDeficit,
          effectiveRateKgPerWeek: result.breakdown.effectiveRateKgPerWeek,
        };
      }
    }
  }

  return {
    profile,
    latestCheckin,
    today,
    dailyCalories,
    trendWeightKg,
    tdee,
    adaptiveTdee,
    regenerate,
    targetChanges,
    activeGoal,
    currentTargetCalories,
    currentTargetProteinG,
    dailyProtein,
  };
}

// The write half. Re-plans from scratch rather than taking a plan from the
// caller: a plan is cheap to recompute and deterministic given the same data,
// and accepting one over the wire would let a client dictate its own targets.
// The narrative is useful context for the next Coach/Dashboard visit, but it
// must never make accepting a check-in wait on a remote AI provider. Persist
// the completed check-in first, return it to the phone, then fill the optional
// note in best-effort background work. A failed provider call simply leaves
// the nullable field empty, exactly as it did before.
async function generateAndStoreCheckinNarrative(
  userId: string,
  checkinId: string,
  input: CheckinNarrativeInput,
  getAccessToken?: () => Promise<string>,
) {
  if (!getAccessToken) return;
  try {
    const narrative = await generateCheckinNarrative(await getAccessToken(), input);
    await db.update(checkins).set({ narrative }).where(and(eq(checkins.id, checkinId), eq(checkins.userId, userId)));
  } catch (err) {
    console.error("checkin narrative generation failed:", err);
  }
}

export async function performCheckin(userId: string, getAccessToken?: () => Promise<string>) {
  const plan = await planCheckin(userId);
  if ("error" in plan) return plan;
  const { profile, latestCheckin, today, dailyCalories, trendWeightKg, tdee, adaptiveTdee, regenerate, targetChanges, activeGoal, currentTargetCalories, currentTargetProteinG, dailyProtein } = plan;

  if (regenerate) {
    for (const day of regenerate.days) {
      await db
        .update(programDays)
        .set({
          targetCalories: day.targetCalories,
          targetProteinG: day.targetProteinG,
          targetCarbsG: day.targetCarbsG,
          targetFatG: day.targetFatG,
        })
        .where(and(eq(programDays.programId, regenerate.programId), eq(programDays.dayOfWeek, day.dayOfWeek)));
    }
    await db
      .update(programs)
      .set({ proteinPerKgUsed: regenerate.proteinPerKgUsed, proteinBasis: regenerate.proteinBasisUsed })
      .where(eq(programs.id, regenerate.programId));
  }

  const windowStart = latestCheckin ? addDaysToDateString(latestCheckin.date, 1) : addDaysToDateString(today, -6);
  const windowDays = latestCheckin ? Math.max(1, daysBetween(latestCheckin.date, today)) : 7;
  const inWindow = dailyCalories.filter((d) => d.date >= windowStart && d.date <= today);
  const proteinInWindow = dailyProtein.filter((d) => d.date >= windowStart && d.date <= today);
  const narrativeInput: CheckinNarrativeInput = {
    isFirstCheckin: latestCheckin == null,
    windowDays,
    loggedDays: inWindow.length,
    trendWeightKg,
    previousTrendWeightKg: latestCheckin?.trendWeightKg ?? null,
    tdee: Math.round(tdee),
    previousTdee: latestCheckin?.tdee ?? null,
    usedAdaptiveTdee: adaptiveTdee !== null,
    avgCaloriesInWindow: inWindow.length > 0 ? inWindow.reduce((s, d) => s + d.calories, 0) / inWindow.length : null,
    // The rate the *program* is set up to deliver, not the rate the goal
    // asked for. These agree unless the absolute calorie floor held the
    // target above the goal rate.
    goal: activeGoal
      ? {
          goalType: activeGoal.goalType,
          targetRateKgPerWeek: targetChanges?.effectiveRateKgPerWeek ?? goalRateKgPerWeek(activeGoal, trendWeightKg),
        }
      : null,
    targetCalories: currentTargetCalories,
    avgProteinInWindow: proteinInWindow.length > 0 ? proteinInWindow.reduce((s, d) => s + d.protein, 0) / proteinInWindow.length : null,
    targetProteinG: currentTargetProteinG,
  };

  const id = randomUUID();
  await db.insert(checkins).values({
    id,
    userId,
    date: today,
    tdee: Math.round(tdee),
    trendWeightKg,
    usedAdaptiveTdee: adaptiveTdee !== null,
    tdeeFluxKcal: adaptiveTdee ? Math.round(adaptiveTdee.fluxKcal) : null,
    narrative: null,
    createdAt: new Date().toISOString(),
  });

  // A completed check-in starts a new cycle, so any ignore from the old one
  // is spent — cleared here rather than relied on to expire, so the stored
  // value never outlives the cycle it described.
  if (profile.checkinIgnoredForDate !== null) {
    await db.update(profiles).set({ checkinIgnoredForDate: null }).where(eq(profiles.userId, userId));
  }

  const [checkin] = await db.select().from(checkins).where(eq(checkins.id, id));
  void generateAndStoreCheckinNarrative(userId, id, narrativeInput, getAccessToken);
  return { checkin, usedAdaptiveTdee: adaptiveTdee !== null, targetChanges };
}

// Shared by POST /api/checkins and its preview so a preview can never succeed
// where the commit behind it would fail, or report the refusal differently.
function checkinErrorBody(result: CheckinRefusal) {
  if (result.error === "checkin_not_due") {
    return { error: `Your next check-in isn't due until ${result.dueDate}.`, dueDate: result.dueDate };
  }
  return { error: result.error === "profile_required" ? "Set up your profile first" : "Log at least one weight first" };
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
    const result = await performCheckin(req.userId!, req.getGatewayAccessToken);
    if ("error" in result) return reply.code(400).send(checkinErrorBody(result));
    reply.code(201);
    return result;
  });

  // What a check-in *would* do. Writes nothing, so the check-in screen can put
  // the new targets in front of you before you accept them (declining silences
  // this cycle's reminders via POST /api/checkins/ignore and leaves the
  // check-in undone). Same due-date gate as the real thing, so the screen can
  // never offer to accept a check-in the commit would then refuse.
  //
  // Shape deliberately mirrors the committed response minus the parts that
  // only exist once a row does (id, createdAt, narrative) — one renderer draws
  // both, and the numbers agree because the commit re-plans identically.
  app.post("/api/checkins/preview", async (req, reply) => {
    const plan = await planCheckin(req.userId!);
    if ("error" in plan) return reply.code(400).send(checkinErrorBody(plan));
    return {
      preview: {
        date: plan.today,
        tdee: Math.round(plan.tdee),
        trendWeightKg: plan.trendWeightKg,
        tdeeFluxKcal: plan.adaptiveTdee ? Math.round(plan.adaptiveTdee.fluxKcal) : null,
      },
      usedAdaptiveTdee: plan.adaptiveTdee !== null,
      targetChanges: plan.targetChanges,
    };
  });

  app.get("/api/checkins", async (req) => {
    return db.select().from(checkins).where(eq(checkins.userId, req.userId!)).orderBy(desc(checkins.date));
  });

  // Silences this cycle's check-in reminders without checking in. Deliberately
  // not an "am I due" override — GET /coach/status still reports the check-in
  // as due, so the Strategy screen keeps offering it; only the reminder
  // surfaces (Dashboard banner, bottom-nav dot) read checkinIgnored.
  app.post("/api/checkins/ignore", async (req, reply) => {
    const userId = req.userId!;
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    if (!profile) return reply.code(400).send({ error: "Set up your profile first" });

    const latestCheckin = await latestCheckinForUser(userId);
    const nextDue = latestCheckin ? nextCheckinDueDate(latestCheckin.date, profile.checkInDayOfWeek) : null;
    await db
      .update(profiles)
      .set({ checkinIgnoredForDate: checkinCycleKey(nextDue), updatedAt: new Date().toISOString() })
      .where(eq(profiles.userId, userId));

    return { ignored: true };
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
    const today = householdDateString();
    const since = addDaysToDateString(today, -(take - 1));

    const { weighIns, dailyCalories } = await gatherDailyTdeeSeriesInputs(userId, take);

    const points: { date: string; tdee: number; fluxKcal: number }[] = [];
    const weighInDates = new Set(weighIns.map((w) => w.date));
    let date = since;
    while (date <= today) {
      // Weight is the limiting side of the energy-balance equation. A day
      // without a new weigh-in contains no new weight-change information,
      // so it is a held estimate in the chart rather than a filled "fresh"
      // point. The client carries the last real point forward explicitly.
      if (weighInDates.has(date)) {
        const weighInsUpToDate = weighIns.filter((w) => w.date <= date);
        const est = estimateAdaptiveTdee(weighInsUpToDate, dailyCalories);
        if (est) points.push({ date, tdee: Math.round(est.tdee), fluxKcal: Math.round(est.fluxKcal) });
      }
      date = addDaysToDateString(date, 1);
    }
    return points;
  });

  app.get("/api/coach/status", async (req) => {
    const userId = req.userId!;
    const currentDate = householdDateString();
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    const latestCheckin = await latestCheckinForUser(userId);
    const trendWeightKg = await currentTrendKg(userId);
    const bodyFatPercent = await mostRecentBodyFatPercent(userId);
    const coverageInputs = await gatherAdaptiveTdeeInputs(userId);
    const expenditureCoverage = adaptiveTdeeCoverage(coverageInputs.weighIns, coverageInputs.dailyCalories);
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
      currentDate,
      profile: profile ?? null,
      latestCheckin: latestCheckin ?? null,
      trendWeightKg,
      bodyFatPercent,
      expenditureCoverage,
      daysSinceCheckin: latestCheckin ? daysBetween(latestCheckin.date, currentDate) : null,
      nextCheckinDueDate: nextCheckinDue,
      // True only while the ignore still describes the *current* cycle — a
      // completed check-in moves the due date on, which re-arms reminders.
      checkinIgnored: profile?.checkinIgnoredForDate != null && profile.checkinIgnoredForDate === checkinCycleKey(nextCheckinDue),
      activeGoal: activeGoal ? serializeGoal(activeGoal) : null,
      activeProgram: activeProgram ? { ...serializeProgram(activeProgram), days: activeProgramDays } : null,
    };
  });
}
