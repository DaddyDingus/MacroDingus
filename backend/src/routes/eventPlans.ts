import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  eventPlans,
  eventPlanDays,
  programs,
  programDays,
  dailyAdjustments,
  logs,
  foods,
} from "../db/schema.js";
import { distributeEventPlan, type DayTargets, type OffsetDayInput } from "../engine/eventPlan.js";
import { addDaysToDateString } from "../engine/trendWeight.js";
import { householdDateString } from "../lib/householdDate.js";
import { scaleNutrition } from "../engine/nutrition.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPREAD_DAYS = 7;

const planInput = z.object({
  eventDate: z.string().regex(DATE_RE),
  label: z.string().max(80).nullable().optional(),
  kind: z.enum(["planned", "recovery"]),
  // A day's whole intake, not the surplus — the user thinks in "I'll eat
  // about 3,000", not "I'll be 600 over".
  eventKcal: z.number().min(0).max(20000),
  windowMode: z.enum(["spread", "week"]),
  spreadDays: z.number().int().min(1).max(MAX_SPREAD_DAYS),
});

// Hand-edited per-day amounts, which flip the plan to distributionMode
// 'custom'. Signed kcal, same convention as the generated rows.
const customDaysInput = z.object({
  days: z.array(
    z.object({
      date: z.string().regex(DATE_RE),
      kcalDelta: z.number().min(-3000).max(5000),
    })
  ),
});

function dayOfWeekFromDateString(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

async function activeProgramWithDays(userId: string) {
  const [program] = await db
    .select()
    .from(programs)
    .where(and(eq(programs.userId, userId), isNull(programs.endedAt)));
  if (!program) return null;
  const days = await db.select().from(programDays).where(eq(programDays.programId, program.id));
  return { program, days };
}

function targetsForWeekday(
  days: { dayOfWeek: number; targetCalories: number; targetProteinG: number; targetCarbsG: number; targetFatG: number }[],
  date: string
): DayTargets | null {
  const row = days.find((d) => d.dayOfWeek === dayOfWeekFromDateString(date));
  if (!row) return null;
  return {
    calories: row.targetCalories,
    proteinG: row.targetProteinG,
    carbsG: row.targetCarbsG,
    fatG: row.targetFatG,
  };
}

// Which calendar days a plan may touch. The event day is never an offset day,
// and neither is anything before today: the past can't be re-targeted, so a
// plan created the night before leans almost entirely on its trailing days.
// That's a real property of the feature, not a degenerate case — it's why
// 'recovery' plans exist at all.
function candidateOffsetDates(
  eventDate: string,
  windowMode: "spread" | "week",
  spreadDays: number,
  kind: "planned" | "recovery",
  today: string
): string[] {
  const dates: string[] = [];
  if (windowMode === "week") {
    // The event's own Sun–Sat week.
    const dow = dayOfWeekFromDateString(eventDate);
    const weekStart = addDaysToDateString(eventDate, -dow);
    for (let i = 0; i < 7; i++) dates.push(addDaysToDateString(weekStart, i));
  } else {
    for (let i = -spreadDays; i <= spreadDays; i++) dates.push(addDaysToDateString(eventDate, i));
  }
  return dates.filter((d) => {
    if (d === eventDate) return false;
    if (d < today) return false;
    // A recovery plan compensates for a day that already happened, so it can
    // only ever look forward.
    if (kind === "recovery" && d < eventDate) return false;
    return true;
  });
}

// Calories already committed on these dates by carry-forward adjustments and
// by *other* plans, so the engine's caps measure against what each day will
// really resolve to rather than its bare weekday template.
async function existingDeltasByDate(userId: string, dates: string[], excludePlanId?: string) {
  const deltas = new Map<string, number>();
  if (dates.length === 0) return deltas;

  const adjustments = await db
    .select()
    .from(dailyAdjustments)
    .where(and(eq(dailyAdjustments.userId, userId), inArray(dailyAdjustments.date, dates)));
  for (const a of adjustments) deltas.set(a.date, (deltas.get(a.date) ?? 0) + a.kcal);

  const otherPlans = await db.select().from(eventPlans).where(eq(eventPlans.userId, userId));
  const otherIds = otherPlans.map((p) => p.id).filter((id) => id !== excludePlanId);
  if (otherIds.length > 0) {
    const rows = await db
      .select()
      .from(eventPlanDays)
      .where(and(inArray(eventPlanDays.planId, otherIds), inArray(eventPlanDays.date, dates)));
    for (const r of rows) deltas.set(r.date, (deltas.get(r.date) ?? 0) + r.kcalDelta);
  }
  return deltas;
}

async function loggedCaloriesForDate(userId: string, date: string): Promise<number | null> {
  const rows = await db
    .select({ log: logs, food: foods })
    .from(logs)
    .innerJoin(foods, eq(logs.foodId, foods.id))
    .where(and(eq(logs.userId, userId), eq(logs.date, date)));
  if (rows.length === 0) return null;
  return rows.reduce((sum, { log, food }) => sum + scaleNutrition(food, log.quantityGrams).calories, 0);
}

// The whole computation with no writes, so the create sheet and the commit
// path can't disagree — same contract as planCheckin(). Returns null when
// there's no active program, since without one there are no targets to shift.
async function planEvent(
  userId: string,
  input: z.infer<typeof planInput>,
  opts: { excludePlanId?: string } = {}
) {
  const active = await activeProgramWithDays(userId);
  if (!active) return null;
  const eventTargets = targetsForWeekday(active.days, input.eventDate);
  if (!eventTargets) return null;

  const today = householdDateString();
  const dates = candidateOffsetDates(input.eventDate, input.windowMode, input.spreadDays, input.kind, today);
  const deltas = await existingDeltasByDate(userId, dates, opts.excludePlanId);

  const offsetDays: OffsetDayInput[] = [];
  for (const date of dates) {
    const targets = targetsForWeekday(active.days, date);
    if (!targets) continue;
    offsetDays.push({ date, targets, existingDeltaKcal: deltas.get(date) ?? 0 });
  }

  const result = distributeEventPlan({
    eventTargets,
    eventKcal: input.eventKcal,
    eventDate: input.eventDate,
    kind: input.kind,
    offsetDays,
    calorieFloorKcal: active.program.calorieFloorKcal,
  });

  const leadDays = dates.filter((d) => d < input.eventDate).length;
  const trailDays = dates.filter((d) => d > input.eventDate).length;

  return { ...result, eventTargets, leadDays, trailDays };
}

async function serializePlan(plan: typeof eventPlans.$inferSelect) {
  const days = await db.select().from(eventPlanDays).where(eq(eventPlanDays.planId, plan.id)).orderBy(eventPlanDays.date);
  return { ...plan, days };
}

export function registerEventPlanRoutes(app: FastifyInstance) {
  // Only plans still capable of changing a target — anything whose last
  // affected day is in the past is spent history, not something to keep
  // showing on Strategy.
  app.get("/api/event-plans", async (req) => {
    const userId = req.userId!;
    const today = householdDateString();
    const plans = await db.select().from(eventPlans).where(eq(eventPlans.userId, userId));
    const serialized = await Promise.all(plans.map(serializePlan));
    return serialized
      .filter((p) => p.days.some((d) => d.date >= today) || p.eventDate >= today)
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  });

  // Every date any active plan touches, with its summed deltas — one call the
  // frontend can layer on top of targetsForDate() without fetching per day.
  app.get("/api/event-plans/deltas", async (req) => {
    const userId = req.userId!;
    const plans = await db.select().from(eventPlans).where(eq(eventPlans.userId, userId));
    if (plans.length === 0) return [];
    const rows = await db
      .select()
      .from(eventPlanDays)
      .where(inArray(eventPlanDays.planId, plans.map((p) => p.id)));
    const byDate = new Map<string, { date: string; kcal: number; proteinG: number; carbsG: number; fatG: number; planIds: string[] }>();
    for (const r of rows) {
      const entry = byDate.get(r.date) ?? { date: r.date, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, planIds: [] };
      entry.kcal += r.kcalDelta;
      entry.proteinG += r.proteinDelta;
      entry.carbsG += r.carbsDelta;
      entry.fatG += r.fatDelta;
      entry.planIds.push(r.planId);
      byDate.set(r.date, entry);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  });

  app.post("/api/event-plans/preview", async (req, reply) => {
    const parsed = planInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await planEvent(req.userId!, parsed.data);
    if (!result) return reply.code(409).send({ error: "no_active_program" });
    return result;
  });

  app.post("/api/event-plans", async (req, reply) => {
    const parsed = planInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.userId!;
    const result = await planEvent(userId, parsed.data);
    if (!result) return reply.code(409).send({ error: "no_active_program" });
    if (result.days.length === 0) return reply.code(409).send({ error: "nothing_to_plan" });

    const id = randomUUID();
    await db.insert(eventPlans).values({
      id,
      userId,
      eventDate: parsed.data.eventDate,
      label: parsed.data.label ?? null,
      kind: parsed.data.kind,
      eventKcal: parsed.data.eventKcal,
      windowMode: parsed.data.windowMode,
      leadDays: result.leadDays,
      trailDays: result.trailDays,
      distributionMode: "even",
      settledAt: null,
      createdAt: new Date().toISOString(),
    });
    await db.insert(eventPlanDays).values(
      result.days.map((d) => ({ id: randomUUID(), planId: id, ...d }))
    );
    const [created] = await db.select().from(eventPlans).where(eq(eventPlans.id, id));
    reply.code(201);
    return serializePlan(created);
  });

  // Hand-editing a day. Only the days already in the plan may be edited —
  // adding a date would need the cap/floor checks the generator applies, and
  // silently skipping those is how you end up with a 700-Calorie Tuesday.
  app.patch("/api/event-plans/:id/days", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = customDaysInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [plan] = await db
      .select()
      .from(eventPlans)
      .where(and(eq(eventPlans.id, id), eq(eventPlans.userId, req.userId!)));
    if (!plan) return reply.code(404).send({ error: "not_found" });

    const existing = await db.select().from(eventPlanDays).where(eq(eventPlanDays.planId, id));
    const active = await activeProgramWithDays(req.userId!);
    const today = householdDateString();

    for (const edit of parsed.data.days) {
      const row = existing.find((r) => r.date === edit.date);
      if (!row) continue;
      // A day that has already passed is settled history; its target can't be
      // moved retroactively.
      if (row.date < today) continue;
      const targets = active ? targetsForWeekday(active.days, row.date) : null;
      const carbsKcal = (targets?.carbsG ?? 0) * 4;
      const fatKcal = (targets?.fatG ?? 0) * 9;
      const nonProtein = carbsKcal + fatKcal;
      const carbsShare = nonProtein > 0 ? carbsKcal / nonProtein : 0;
      await db
        .update(eventPlanDays)
        .set({
          kcalDelta: edit.kcalDelta,
          proteinDelta: 0,
          carbsDelta: Math.round(((edit.kcalDelta * carbsShare) / 4) * 10) / 10,
          fatDelta: Math.round(((edit.kcalDelta * (1 - carbsShare)) / 9) * 10) / 10,
        })
        .where(eq(eventPlanDays.id, row.id));
    }

    await db.update(eventPlans).set({ distributionMode: "custom" }).where(eq(eventPlans.id, id));
    const [updated] = await db.select().from(eventPlans).where(eq(eventPlans.id, id));
    return serializePlan(updated);
  });

  // Reset a hand-edited plan back to an even spread.
  app.post("/api/event-plans/:id/reset", async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.userId!;
    const [plan] = await db
      .select()
      .from(eventPlans)
      .where(and(eq(eventPlans.id, id), eq(eventPlans.userId, userId)));
    if (!plan) return reply.code(404).send({ error: "not_found" });

    const spreadDays = Math.max(plan.leadDays, plan.trailDays, 1);
    const result = await planEvent(
      userId,
      {
        eventDate: plan.eventDate,
        label: plan.label,
        kind: plan.kind as "planned" | "recovery",
        eventKcal: plan.eventKcal,
        windowMode: plan.windowMode as "spread" | "week",
        spreadDays: Math.min(spreadDays, MAX_SPREAD_DAYS),
      },
      { excludePlanId: id }
    );
    if (!result) return reply.code(409).send({ error: "no_active_program" });

    await db.delete(eventPlanDays).where(eq(eventPlanDays.planId, id));
    await db.insert(eventPlanDays).values(result.days.map((d) => ({ id: randomUUID(), planId: id, ...d })));
    await db.update(eventPlans).set({ distributionMode: "even" }).where(eq(eventPlans.id, id));
    const [updated] = await db.select().from(eventPlans).where(eq(eventPlans.id, id));
    return serializePlan(updated);
  });

  // Settle up: replace the estimate with what was actually logged on the
  // event day and redistribute across whatever days remain. Never automatic —
  // the app doesn't move targets behind the user's back — and never touches
  // days that have already passed.
  app.post("/api/event-plans/:id/settle", async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.userId!;
    const [plan] = await db
      .select()
      .from(eventPlans)
      .where(and(eq(eventPlans.id, id), eq(eventPlans.userId, userId)));
    if (!plan) return reply.code(404).send({ error: "not_found" });

    const actual = await loggedCaloriesForDate(userId, plan.eventDate);
    if (actual === null) return reply.code(409).send({ error: "event_day_not_logged" });

    const spreadDays = Math.max(plan.leadDays, plan.trailDays, 1);
    const result = await planEvent(
      userId,
      {
        eventDate: plan.eventDate,
        label: plan.label,
        kind: plan.kind as "planned" | "recovery",
        eventKcal: Math.round(actual),
        windowMode: plan.windowMode as "spread" | "week",
        spreadDays: Math.min(spreadDays, MAX_SPREAD_DAYS),
      },
      { excludePlanId: id }
    );
    if (!result) return reply.code(409).send({ error: "no_active_program" });

    const today = householdDateString();
    // Keep every already-elapsed day exactly as it was — those targets were
    // real and were eaten against.
    const past = (await db.select().from(eventPlanDays).where(eq(eventPlanDays.planId, id))).filter(
      (d) => d.date < today
    );
    await db.delete(eventPlanDays).where(eq(eventPlanDays.planId, id));
    const keep = past.map((d) => ({
      id: randomUUID(),
      planId: id,
      date: d.date,
      kcalDelta: d.kcalDelta,
      proteinDelta: d.proteinDelta,
      carbsDelta: d.carbsDelta,
      fatDelta: d.fatDelta,
    }));
    const fresh = result.days
      .filter((d) => d.date >= today)
      .map((d) => ({ id: randomUUID(), planId: id, ...d }));
    if (keep.length + fresh.length > 0) await db.insert(eventPlanDays).values([...keep, ...fresh]);

    await db
      .update(eventPlans)
      .set({ eventKcal: Math.round(actual), settledAt: new Date().toISOString(), distributionMode: "even" })
      .where(eq(eventPlans.id, id));
    const [updated] = await db.select().from(eventPlans).where(eq(eventPlans.id, id));
    return serializePlan(updated);
  });

  app.delete("/api/event-plans/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [plan] = await db
      .select()
      .from(eventPlans)
      .where(and(eq(eventPlans.id, id), eq(eventPlans.userId, req.userId!)));
    if (!plan) return reply.code(404).send({ error: "not_found" });
    await db.delete(eventPlanDays).where(eq(eventPlanDays.planId, id));
    await db.delete(eventPlans).where(eq(eventPlans.id, id));
    reply.code(204);
    return null;
  });
}
