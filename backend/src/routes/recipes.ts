import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { foods, recipes, recipeIngredients } from "../db/schema.js";
import { scaleNutrition, sumNutrition } from "../engine/nutrition.js";
import { importRecipeFromUrl } from "../engine/recipeImport.js";
import { anthropicKeyStatus } from "../engine/anthropicClient.js";

const recipeInput = z.object({
  name: z.string().min(1),
  // A user-picked emoji override for the recipe's materialized food row —
  // same column/convention as a plain custom food's `icon` (see foods.ts).
  icon: z.string().nullable().optional(),
  servings: z.number().positive(),
  // Defaults to the ingredient weight sum — override when cooking changes the
  // total weight (water loss/gain) without changing total calories, so
  // nutrition-per-gram of the finished product stays accurate.
  totalWeightGrams: z.number().positive().optional(),
  ingredients: z
    .array(
      z.object({
        foodId: z.string(),
        quantityGrams: z.number().positive(),
      })
    )
    .min(1)
    .max(50),
});

async function computeNutritionPer100g(ingredients: { foodId: string; quantityGrams: number }[], totalWeightGrams: number) {
  const foodIds = [...new Set(ingredients.map((i) => i.foodId))];
  const foundFoods = await db.select().from(foods).where(inArray(foods.id, foodIds));
  const foodMap = new Map(foundFoods.map((f) => [f.id, f]));
  if (foundFoods.length !== foodIds.length) return null;

  const totals = sumNutrition(ingredients.map((i) => scaleNutrition(foodMap.get(i.foodId)!, i.quantityGrams)));
  const factor = 100 / totalWeightGrams;
  return {
    caloriesPer100g: totals.calories * factor,
    proteinPer100g: totals.protein * factor,
    carbsPer100g: totals.carbs * factor,
    fatPer100g: totals.fat * factor,
    fiberPer100g: totals.fiber * factor,
    sugarPer100g: totals.sugar * factor,
    saturatedFatPer100g: totals.saturatedFat * factor,
    sodiumMgPer100g: totals.sodiumMg * factor,
  };
}

async function recipeDetail(recipeId: string, userId: string) {
  const [recipe] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.userId, userId)));
  if (!recipe) return null;

  const ingredientRows = await db
    .select({ ingredient: recipeIngredients, food: foods })
    .from(recipeIngredients)
    .innerJoin(foods, eq(recipeIngredients.foodId, foods.id))
    .where(eq(recipeIngredients.recipeId, recipeId));

  const [food] = await db.select().from(foods).where(eq(foods.id, recipe.foodId));

  return {
    id: recipe.id,
    name: recipe.name,
    servings: recipe.servings,
    totalWeightGrams: recipe.totalWeightGrams,
    food,
    ingredients: ingredientRows.map(({ ingredient, food: ingredientFood }) => ({
      foodId: ingredientFood.id,
      food: ingredientFood,
      quantityGrams: ingredient.quantityGrams,
    })),
  };
}

export function registerRecipeRoutes(app: FastifyInstance) {
  app.get("/api/recipes", async (req) => {
    const rows = await db.select().from(recipes).where(eq(recipes.userId, req.userId!));
    const foodIds = rows.map((r) => r.foodId);
    const foundFoods = foodIds.length ? await db.select().from(foods).where(inArray(foods.id, foodIds)) : [];
    const foodMap = new Map(foundFoods.map((f) => [f.id, f]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      servings: r.servings,
      totalWeightGrams: r.totalWeightGrams,
      food: foodMap.get(r.foodId),
    }));
  });

  app.get("/api/recipes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = await recipeDetail(id, req.userId!);
    if (!detail) return reply.code(404).send({ error: "not found" });
    return detail;
  });

  // Fetches a recipe URL and hands it to Claude to extract into structured
  // data, ready for RecipeForm's `initial` prop — same "always a real,
  // reviewable draft, never auto-saved" shape as label scanning and
  // describe-meal. See engine/recipeImport.ts for the fetch/parse/match
  // logic. Same 503-when-unconfigured convention as those two features.
  app.post("/api/recipes/import-url", async (req, reply) => {
    if (!anthropicKeyStatus(req.userId!).configured) {
      reply.code(503);
      return { error: "Recipe import isn't configured on this server yet" };
    }

    const parsed = z.object({ url: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    try {
      return await importRecipeFromUrl(req.userId!, parsed.data.url);
    } catch (err) {
      req.log.error(err);
      reply.code(502);
      return { error: err instanceof Error ? err.message : "Couldn't import a recipe from that link" };
    }
  });

  app.post("/api/recipes", async (req, reply) => {
    const parsed = recipeInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { name, icon, servings, ingredients } = parsed.data;
    const ingredientSumGrams = ingredients.reduce((sum, i) => sum + i.quantityGrams, 0);
    const totalWeightGrams = parsed.data.totalWeightGrams ?? ingredientSumGrams;

    const nutrition = await computeNutritionPer100g(ingredients, totalWeightGrams);
    if (!nutrition) return reply.code(400).send({ error: "unknown foodId" });

    const now = new Date().toISOString();
    const foodId = randomUUID();
    await db.insert(foods).values({
      id: foodId,
      name,
      icon,
      source: "recipe",
      servingSizeGrams: totalWeightGrams / servings,
      servingName: "1 serving",
      createdAt: now,
      ...nutrition,
    });

    const recipeId = randomUUID();
    await db.insert(recipes).values({
      id: recipeId,
      userId: req.userId!,
      foodId,
      name,
      totalWeightGrams,
      servings,
      createdAt: now,
    });

    await db.insert(recipeIngredients).values(
      ingredients.map((i) => ({
        id: randomUUID(),
        recipeId,
        foodId: i.foodId,
        quantityGrams: i.quantityGrams,
      }))
    );

    const [food] = await db.select().from(foods).where(eq(foods.id, foodId));
    reply.code(201);
    return food;
  });

  // Recomputes and overwrites the materialized food row in place, so any log
  // entries already referencing it pick up the corrected nutrition (same
  // retroactive-edit behavior as editing a plain custom food — nothing is
  // snapshotted at log time anywhere in this app).
  app.patch("/api/recipes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = recipeInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const [recipe] = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.userId, req.userId!)));
    if (!recipe) return reply.code(404).send({ error: "not found" });

    const { name, icon, servings, ingredients } = parsed.data;
    const ingredientSumGrams = ingredients.reduce((sum, i) => sum + i.quantityGrams, 0);
    const totalWeightGrams = parsed.data.totalWeightGrams ?? ingredientSumGrams;

    const nutrition = await computeNutritionPer100g(ingredients, totalWeightGrams);
    if (!nutrition) return reply.code(400).send({ error: "unknown foodId" });

    await db
      .update(foods)
      .set({
        name,
        ...(icon !== undefined ? { icon } : {}),
        servingSizeGrams: totalWeightGrams / servings,
        ...nutrition,
      })
      .where(eq(foods.id, recipe.foodId));

    await db.update(recipes).set({ name, servings, totalWeightGrams }).where(eq(recipes.id, id));

    await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
    await db.insert(recipeIngredients).values(
      ingredients.map((i) => ({
        id: randomUUID(),
        recipeId: id,
        foodId: i.foodId,
        quantityGrams: i.quantityGrams,
      }))
    );

    return recipeDetail(id, req.userId!);
  });

  // Deletes the recipe's own metadata unconditionally; the materialized food
  // row is only deleted if nothing (a log entry) references it yet — if it's
  // already been logged, it's left in place as an ordinary food so history
  // stays intact, just no longer editable as a recipe.
  app.delete("/api/recipes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [recipe] = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.userId, req.userId!)));
    if (!recipe) return reply.code(404).send({ error: "not found" });

    await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
    await db.delete(recipes).where(eq(recipes.id, id));
    try {
      await db.delete(foods).where(eq(foods.id, recipe.foodId));
    } catch {
      // Still referenced by a log entry — can't hard-delete without breaking
      // that history, so hide it instead of leaving it silently searchable:
      // gone from Library/search/Favorites, but existing logs and copy-day
      // still resolve it normally (see foods route's DELETE for the same
      // pattern on plain custom foods).
      await db.update(foods).set({ hiddenAt: new Date().toISOString() }).where(eq(foods.id, recipe.foodId));
    }

    reply.code(204);
    return null;
  });
}
