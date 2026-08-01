import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { programs, programDays, profiles, goals } from "../db/schema.js";
import { gatherAdaptiveTdeeInputs, mostRecentBodyFatPercent, shiftedHighDaysJson, serializeProgram } from "./shared.js";
import { generateCoachedProgramDays, type ProteinLevel, type DietType } from "../engine/program.js";

const dayValuesInput = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  targetCalories: z.number().nonnegative(),
  targetProteinG: z.number().nonnegative(),
  targetCarbsG: z.number().nonnegative(),
  targetFatG: z.number().nonnegative(),
});

const coachedProgramInput = z.object({
  goalId: z.string(),
  style: z.literal("coached"),
  dietType: z.enum(["balanced", "low_fat", "low_carb", "keto"]),
  calorieFloorKcal: z.number().min(0).max(5000),
  proteinLevel: z.enum(["low", "moderate", "high", "extra_high"]),
  distributionMode: z.enum(["even", "shifted"]),
  // Required (checked below, not via a zod .refine() — wrapping this object
  // in .refine() would turn it into a ZodEffects that z.discriminatedUnion
  // can no longer introspect for its "style" discriminator) when
  // distributionMode is 'shifted': which days get the higher target.
  shiftedHighDays: z.array(z.number().int().min(0).max(6)).min(1).max(6).optional(),
  proteinBasis: z.enum(["total", "lean"]).default("total"),
});

const manualProgramInput = z.object({
  goalId: z.string(),
  style: z.literal("manual"),
  days: z.array(dayValuesInput).length(7),
});

const programInput = z.discriminatedUnion("style", [coachedProgramInput, manualProgramInput]);

const daysUpdateInput = z.object({
  days: z.array(dayValuesInput).min(1).max(7),
});

async function fetchProgramWithDays(programId: string) {
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return null;
  const days = await db
    .select()
    .from(programDays)
    .where(eq(programDays.programId, programId))
    .orderBy(programDays.dayOfWeek);
  return { ...serializeProgram(program), days };
}

export function registerProgramRoutes(app: FastifyInstance) {
  app.get("/api/programs", async (req) => {
    const userId = req.userId!;
    const rows = await db.select().from(programs).where(eq(programs.userId, userId)).orderBy(desc(programs.startedAt));
    return Promise.all(
      rows.map(async (p) => ({
        ...serializeProgram(p),
        days: await db.select().from(programDays).where(eq(programDays.programId, p.id)).orderBy(programDays.dayOfWeek),
      }))
    );
  });

  // The New Program wizard's final submit. Closes the previous active
  // program (endedAt = now) and inserts the new one + its 7 program_days
  // rows — coached via generateCoachedProgramDays() (same TDEE estimation
  // performCheckin() uses), manual straight from the caller's own values.
  // Returns the created program (with days) plus, for coached, the
  // breakdown numbers the results screen's "How was your program designed?"
  // reasoning steps need — computed once here, not re-derived client-side.
  app.post("/api/programs", async (req, reply) => {
    const parsed = programInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.style === "coached" && parsed.data.distributionMode === "shifted" && !parsed.data.shiftedHighDays) {
      return reply.code(400).send({ error: "Select which days should have higher Calorie targets" });
    }
    const userId = req.userId!;
    const now = new Date().toISOString();

    const [goal] = await db.select().from(goals).where(and(eq(goals.id, parsed.data.goalId), eq(goals.userId, userId)));
    if (!goal) return reply.code(404).send({ error: "Goal not found" });

    let dayRows: z.infer<typeof dayValuesInput>[];
    let programFields: {
      style: string;
      dietType: string | null;
      calorieFloorKcal: number | null;
      proteinLevel: string | null;
      proteinPerKgUsed: number | null;
      proteinBasis: string;
      distributionMode: string;
      shiftedHighDays: string | null;
    };
    let breakdown: ReturnType<typeof generateCoachedProgramDays>["breakdown"] | null = null;

    if (parsed.data.style === "coached") {
      const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
      if (!profile) return reply.code(400).send({ error: "Set up your profile first" });
      const { weighIns, dailyCalories } = await gatherAdaptiveTdeeInputs(userId);
      if (weighIns.length === 0) return reply.code(400).send({ error: "Log at least one weight first" });

      const age = new Date().getFullYear() - profile.birthYear;
      const bodyFatPercent = await mostRecentBodyFatPercent(userId);
      const result = generateCoachedProgramDays({
        weighIns,
        dailyCalories,
        sex: profile.sex as "male" | "female",
        age,
        heightCm: profile.heightCm,
        activityLevel: profile.activityLevel,
        targetRateKgPerWeek: goal.targetRateKgPerWeek,
        dietType: parsed.data.dietType as DietType,
        proteinLevel: parsed.data.proteinLevel as ProteinLevel,
        calorieFloorKcal: parsed.data.calorieFloorKcal,
        distributionMode: parsed.data.distributionMode,
        shiftedHighDays: parsed.data.shiftedHighDays,
        proteinBasis: parsed.data.proteinBasis,
        bodyFatPercent,
        weeklyExerciseHours: profile.weeklyExerciseHours ?? null,
      });
      dayRows = result.days;
      breakdown = result.breakdown;
      programFields = {
        style: "coached",
        dietType: parsed.data.dietType,
        calorieFloorKcal: parsed.data.calorieFloorKcal,
        proteinLevel: parsed.data.proteinLevel,
        proteinPerKgUsed: result.breakdown.proteinPerKgUsed,
        proteinBasis: result.breakdown.proteinBasisUsed,
        distributionMode: parsed.data.distributionMode,
        shiftedHighDays: parsed.data.distributionMode === "shifted" ? shiftedHighDaysJson(parsed.data.shiftedHighDays) : null,
      };
    } else {
      dayRows = parsed.data.days;
      programFields = {
        style: "manual",
        dietType: null,
        calorieFloorKcal: null,
        proteinLevel: null,
        proteinPerKgUsed: null,
        proteinBasis: "total",
        distributionMode: "custom",
        shiftedHighDays: null,
      };
    }

    await db.update(programs).set({ endedAt: now }).where(and(eq(programs.userId, userId), isNull(programs.endedAt)));

    const id = randomUUID();
    await db.insert(programs).values({ id, userId, goalId: parsed.data.goalId, ...programFields, startedAt: now, createdAt: now });
    await db.insert(programDays).values(dayRows.map((d) => ({ id: randomUUID(), programId: id, ...d })));

    const program = await fetchProgramWithDays(id);
    reply.code(201);
    return { program, breakdown };
  });

  // Individual per-day edits (Edit Program's sliders) and bulk saves both
  // land here. Flips distributionMode to 'custom' — this is what
  // performCheckin() checks to decide whether a check-in is allowed to
  // silently refresh this program's targets (custom ones are left alone).
  app.patch("/api/programs/:id/days", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = daysUpdateInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = req.userId!;

    const [program] = await db.select().from(programs).where(and(eq(programs.id, id), eq(programs.userId, userId)));
    if (!program) return reply.code(404).send({ error: "Program not found" });

    for (const day of parsed.data.days) {
      await db
        .update(programDays)
        .set({
          targetCalories: day.targetCalories,
          targetProteinG: day.targetProteinG,
          targetCarbsG: day.targetCarbsG,
          targetFatG: day.targetFatG,
        })
        .where(and(eq(programDays.programId, id), eq(programDays.dayOfWeek, day.dayOfWeek)));
    }
    await db.update(programs).set({ distributionMode: "custom" }).where(eq(programs.id, id));

    return fetchProgramWithDays(id);
  });

  // "Reset All Days" — regenerates a Coached program's targets fresh (same
  // formula as creation, current TDEE estimate), always resetting to an
  // even distribution and discarding any per-day customization. Manual
  // programs have no formula to regenerate from.
  app.post("/api/programs/:id/regenerate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.userId!;

    const [program] = await db.select().from(programs).where(and(eq(programs.id, id), eq(programs.userId, userId)));
    if (!program) return reply.code(404).send({ error: "Program not found" });
    if (program.style !== "coached") return reply.code(400).send({ error: "Only Coached programs can be regenerated" });

    const [goal] = await db.select().from(goals).where(eq(goals.id, program.goalId));
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    if (!goal || !profile) return reply.code(400).send({ error: "Missing goal or profile" });

    const { weighIns, dailyCalories } = await gatherAdaptiveTdeeInputs(userId);
    if (weighIns.length === 0) return reply.code(400).send({ error: "Log at least one weight first" });

    const age = new Date().getFullYear() - profile.birthYear;
    const bodyFatPercent = await mostRecentBodyFatPercent(userId);
    const result = generateCoachedProgramDays({
      weighIns,
      dailyCalories,
      sex: profile.sex as "male" | "female",
      age,
      heightCm: profile.heightCm,
      activityLevel: profile.activityLevel,
      targetRateKgPerWeek: goal.targetRateKgPerWeek,
      dietType: program.dietType as DietType,
      proteinLevel: program.proteinLevel as ProteinLevel,
      calorieFloorKcal: program.calorieFloorKcal!,
      distributionMode: "even",
      proteinBasis: program.proteinBasis as "total" | "lean",
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
        .where(and(eq(programDays.programId, id), eq(programDays.dayOfWeek, day.dayOfWeek)));
    }
    await db
      .update(programs)
      .set({
        distributionMode: "even",
        proteinPerKgUsed: result.breakdown.proteinPerKgUsed,
        proteinBasis: result.breakdown.proteinBasisUsed,
      })
      .where(eq(programs.id, id));

    const updated = await fetchProgramWithDays(id);
    return { program: updated, breakdown: result.breakdown };
  });
}
