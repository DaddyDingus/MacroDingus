import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { z } from "zod";
import { and, eq, ne, inArray, getTableColumns, getTableName } from "drizzle-orm";
import { db, sqlite } from "../db/index.js";
import {
  logs, favorites, cookware, foodSearchStats, programDays, programs, checkins, goals, weights, photos, profiles, users,
  nutritionDayStatuses, dailyAdjustments, measurements, userSettings, recipes, recipeIngredients, foods,
  stepRecords, stepDailyTotals, stepSyncState,
} from "../db/schema.js";
import { createServerBackup, serverBackupStatus } from "../lib/serverBackups.js";
import { purgeUserData } from "../lib/userData.js";

const nameSchema = z.object({ name: z.string().trim().min(1).max(40) });
const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});
const exportRowSchema = z.record(z.string(), z.unknown());
const accountImportSchema = z.object({
  format: z.literal("macrotrack-account-export"),
  version: z.literal(1),
  profile: exportRowSchema.nullable(),
  weights: z.array(exportRowSchema),
  logs: z.array(exportRowSchema),
  foods: z.array(exportRowSchema),
  goals: z.array(exportRowSchema),
  programs: z.array(exportRowSchema),
  programDays: z.array(exportRowSchema),
  checkins: z.array(exportRowSchema),
  nutritionDayStatuses: z.array(exportRowSchema),
  dailyAdjustments: z.array(exportRowSchema),
  measurements: z.array(exportRowSchema),
  favorites: z.array(exportRowSchema),
  cookware: z.array(exportRowSchema),
  foodSearchStats: z.array(exportRowSchema).optional().default([]),
  recipes: z.array(exportRowSchema),
  recipeIngredients: z.array(exportRowSchema),
  stepRecords: z.array(exportRowSchema).optional().default([]),
  stepDailyTotals: z.array(exportRowSchema).optional().default([]),
  stepSyncState: exportRowSchema.nullable().optional().default(null),
  settings: exportRowSchema.nullable(),
}).passthrough();

type ExportRow = Record<string, unknown>;

function remapIds(rows: ExportRow[]): { rows: ExportRow[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.id !== "string") throw new Error("An imported row is missing its ID");
    ids.set(row.id, crypto.randomUUID());
  }
  return { rows: rows.map((row) => ({ ...row, id: ids.get(row.id as string)! })), ids };
}

function insertExportRow(table: Parameters<typeof getTableName>[0], row: ExportRow, orIgnore = false): void {
  const columns = getTableColumns(table);
  const entries = Object.entries(columns).filter(([property]) => Object.prototype.hasOwnProperty.call(row, property));
  if (!entries.length) throw new Error(`No usable columns for ${getTableName(table)}`);
  const names = entries.map(([, column]) => `"${column.name}"`).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  const values = entries.map(([property]) => typeof row[property] === "boolean" ? Number(row[property]) : row[property] ?? null);
  const verb = orIgnore ? "INSERT OR IGNORE" : "INSERT";
  sqlite.prepare(`${verb} INTO "${getTableName(table)}" (${names}) VALUES (${placeholders})`).run(...values);
}

function restoreAccountExport(userId: string, input: z.infer<typeof accountImportSchema>): void {
  const goalsImport = remapIds(input.goals);
  const programsImport = remapIds(input.programs);
  const recipesImport = remapIds(input.recipes);

  const remapSimple = (rows: ExportRow[]) => remapIds(rows).rows.map((row) => ({ ...row, userId }));
  const restore = sqlite.transaction(() => {
    const currentPrograms = sqlite.prepare("SELECT id FROM programs WHERE user_id = ?").all(userId) as { id: string }[];
    const currentRecipes = sqlite.prepare("SELECT id FROM recipes WHERE user_id = ?").all(userId) as { id: string }[];
    for (const row of currentPrograms) sqlite.prepare("DELETE FROM program_days WHERE program_id = ?").run(row.id);
    for (const row of currentRecipes) sqlite.prepare("DELETE FROM recipe_ingredients WHERE recipe_id = ?").run(row.id);
    for (const table of [
      "logs", "nutrition_day_statuses", "daily_adjustments", "measurements", "favorites", "cookware",
      "food_search_stats", "step_records", "step_daily_totals", "step_sync_state", "steps_webhook_tokens",
      "user_settings", "recipes", "programs", "checkins", "goals", "weights", "profiles",
    ]) {
      sqlite.prepare(`DELETE FROM "${table}" WHERE user_id = ?`).run(userId);
    }

    for (const row of input.foods) insertExportRow(foods, row, true);
    if (input.profile) insertExportRow(profiles, { ...input.profile, userId });
    for (const row of remapSimple(input.weights)) insertExportRow(weights, row);
    for (const row of remapSimple(input.logs)) insertExportRow(logs, row);
    for (const row of goalsImport.rows) insertExportRow(goals, { ...row, userId });
    for (const row of programsImport.rows) {
      const goalId = goalsImport.ids.get(String(row.goalId));
      if (!goalId) throw new Error("An imported program refers to a missing goal");
      insertExportRow(programs, { ...row, userId, goalId });
    }
    for (const row of remapIds(input.programDays).rows) {
      const programId = programsImport.ids.get(String(row.programId));
      if (!programId) throw new Error("An imported program day refers to a missing program");
      insertExportRow(programDays, { ...row, programId });
    }
    for (const row of remapSimple(input.checkins)) insertExportRow(checkins, row);
    for (const row of remapSimple(input.nutritionDayStatuses)) insertExportRow(nutritionDayStatuses, row);
    for (const row of remapSimple(input.dailyAdjustments)) insertExportRow(dailyAdjustments, row);
    for (const row of remapSimple(input.measurements)) insertExportRow(measurements, row);
    for (const row of remapSimple(input.favorites)) insertExportRow(favorites, row);
    for (const row of remapSimple(input.cookware)) insertExportRow(cookware, row);
    for (const row of remapSimple(input.foodSearchStats)) insertExportRow(foodSearchStats, row);
    for (const row of remapSimple(input.stepRecords)) insertExportRow(stepRecords, row);
    for (const row of remapSimple(input.stepDailyTotals)) insertExportRow(stepDailyTotals, row);
    if (input.stepSyncState) insertExportRow(stepSyncState, { ...input.stepSyncState, userId });
    for (const row of recipesImport.rows) insertExportRow(recipes, { ...row, userId });
    for (const row of remapIds(input.recipeIngredients).rows) {
      const recipeId = recipesImport.ids.get(String(row.recipeId));
      if (!recipeId) throw new Error("An imported ingredient refers to a missing recipe");
      insertExportRow(recipeIngredients, { ...row, recipeId });
    }
    if (input.settings) insertExportRow(userSettings, { ...input.settings, userId });
  });
  restore();
}

// Self-service version of the manual DB wipe used to reset a test/mock
// account — scoped to exactly one user's own data. Deliberately does NOT
// touch `foods`: those rows are shared across every account (see schema.ts),
// so a solo reset shouldn't nuke a library another household member relies
// on. Recipe metadata is per-user and is cleared; its materialized food row
// remains available if another user's log references it.
// Clearing the profile is intentional, not incidental — it's what lets
// App.tsx's onboarding gate (no profile => OnboardingFlow) pick the account
// back up as fresh on the very next load, rather than leaving it in a
// half-reset state with no data but a still-configured profile.
export function registerAccountRoutes(app: FastifyInstance, dataDir: string) {
  app.get("/api/account/backup-status", async () => serverBackupStatus());

  app.post("/api/account/backup", async (_req, reply) => {
    try {
      return await createServerBackup();
    } catch {
      return reply.code(500).send({ error: "Couldn't create a server backup" });
    }
  });

  app.get("/api/account/export", async (req) => {
    const userId = req.userId!;
    const [user] = await db.select({ id: users.id, name: users.name, createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
    const [profileRows, weightRows, logRows, goalRows, programRows, checkinRows, photoRows, measurementRows, favoriteRows, cookwareRows, adjustmentRows, statusRows, settingsRows, recipeRows, searchStatRows, stepRecordRows, stepDailyRows, stepSyncRows] = await Promise.all([
      db.select().from(profiles).where(eq(profiles.userId, userId)),
      db.select().from(weights).where(eq(weights.userId, userId)),
      db.select().from(logs).where(eq(logs.userId, userId)),
      db.select().from(goals).where(eq(goals.userId, userId)),
      db.select().from(programs).where(eq(programs.userId, userId)),
      db.select().from(checkins).where(eq(checkins.userId, userId)),
      db.select().from(photos).where(eq(photos.userId, userId)),
      db.select().from(measurements).where(eq(measurements.userId, userId)),
      db.select().from(favorites).where(eq(favorites.userId, userId)),
      db.select().from(cookware).where(eq(cookware.userId, userId)),
      db.select().from(dailyAdjustments).where(eq(dailyAdjustments.userId, userId)),
      db.select().from(nutritionDayStatuses).where(eq(nutritionDayStatuses.userId, userId)),
      db.select().from(userSettings).where(eq(userSettings.userId, userId)),
      db.select().from(recipes).where(eq(recipes.userId, userId)),
      db.select().from(foodSearchStats).where(eq(foodSearchStats.userId, userId)),
      db.select().from(stepRecords).where(eq(stepRecords.userId, userId)),
      db.select().from(stepDailyTotals).where(eq(stepDailyTotals.userId, userId)),
      db.select().from(stepSyncState).where(eq(stepSyncState.userId, userId)),
    ]);
    const programIds = programRows.map((row) => row.id);
    const recipeIds = recipeRows.map((row) => row.id);
    const dayRows = programIds.length ? await db.select().from(programDays).where(inArray(programDays.programId, programIds)) : [];
    const ingredientRows = recipeIds.length ? await db.select().from(recipeIngredients).where(inArray(recipeIngredients.recipeId, recipeIds)) : [];
    const foodIds = [...new Set([
      ...logRows.map((row) => row.foodId),
      ...favoriteRows.map((row) => row.foodId),
      ...recipeRows.map((row) => row.foodId),
      ...ingredientRows.map((row) => row.foodId),
      ...searchStatRows.flatMap((row) => row.selectedFoodId ? [row.selectedFoodId] : []),
    ])];
    const foodRows = foodIds.length ? await db.select().from(foods).where(inArray(foods.id, foodIds)) : [];

    return {
      format: "macrotrack-account-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      note: "Progress-photo files and secret API keys are intentionally excluded. Back up DATA_DIR for a full disaster-recovery copy.",
      user,
      profile: profileRows[0] ?? null,
      weights: weightRows,
      logs: logRows,
      foods: foodRows,
      goals: goalRows,
      programs: programRows,
      programDays: dayRows,
      checkins: checkinRows,
      nutritionDayStatuses: statusRows,
      dailyAdjustments: adjustmentRows,
      measurements: measurementRows,
      favorites: favoriteRows,
      cookware: cookwareRows,
      foodSearchStats: searchStatRows,
      recipes: recipeRows,
      recipeIngredients: ingredientRows,
      stepRecords: stepRecordRows,
      stepDailyTotals: stepDailyRows,
      stepSyncState: stepSyncRows[0] ?? null,
      photos: photoRows,
      settings: settingsRows[0] ?? null,
    };
  });

  app.post("/api/account/import", { bodyLimit: 25 * 1024 * 1024 }, async (req, reply) => {
    const parsed = accountImportSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "That isn't a compatible MacroDaddy export" });
    try {
      // Always leave a recoverable server snapshot immediately before the
      // destructive replace, independent of the daily schedule.
      await createServerBackup();
      restoreAccountExport(req.userId!, parsed.data);
      return { ok: true, importedAt: new Date().toISOString() };
    } catch (err) {
      req.log.warn({ err }, "account import failed");
      return reply.code(400).send({ error: "The export could not be restored" });
    }
  });

  app.patch("/api/account/name", async (req, reply) => {
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Enter a name" };
    }
    const userId = req.userId!;
    const { name } = parsed.data;

    const [existing] = await db.select({ id: users.id }).from(users).where(and(eq(users.name, name), ne(users.id, userId)));
    if (existing) {
      reply.code(409);
      return { error: "That name is already taken" };
    }

    await db.update(users).set({ name }).where(eq(users.id, userId));
    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
    return { ok: true, user: { id: userId, name, role: user?.role === "admin" ? "admin" : "member" } };
  });

  app.patch("/api/account/password", async (req, reply) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "New password must be at least 8 characters" };
    }
    const userId = req.userId!;
    const { currentPassword, newPassword } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      reply.code(401);
      return { error: "Current password is incorrect" };
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    return { ok: true };
  });

  app.delete("/api/account/data", async (req, reply) => {
    // Table list lives in lib/userData.ts, shared with the admin delete —
    // this route previously kept its own copy and silently missed the
    // event-plan tables for as long as they existed. Saved AI keys survive a
    // self-service clear; only deleting the account removes those.
    await purgeUserData(req.userId!, dataDir);

    reply.code(204);
    return null;
  });
}
