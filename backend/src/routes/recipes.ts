import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { foods, recipes, recipeIngredients } from "../db/schema.js";
import { scaleNutrition, sumNutrition } from "../engine/nutrition.js";

const recipeInput = z.object({
  name: z.string().min(1),
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

export function registerRecipeRoutes(app: FastifyInstance) {
  app.post("/api/recipes", async (req, reply) => {
    const parsed = recipeInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { name, servings, ingredients } = parsed.data;
    const foodIds = [...new Set(ingredients.map((i) => i.foodId))];
    const foundFoods = await db.select().from(foods).where(inArray(foods.id, foodIds));
    const foodMap = new Map(foundFoods.map((f) => [f.id, f]));
    if (foundFoods.length !== foodIds.length) return reply.code(400).send({ error: "unknown foodId" });

    const ingredientSumGrams = ingredients.reduce((sum, i) => sum + i.quantityGrams, 0);
    const totalWeightGrams = parsed.data.totalWeightGrams ?? ingredientSumGrams;

    const totals = sumNutrition(ingredients.map((i) => scaleNutrition(foodMap.get(i.foodId)!, i.quantityGrams)));
    const factor = 100 / totalWeightGrams;

    const now = new Date().toISOString();
    const foodId = randomUUID();
    await db.insert(foods).values({
      id: foodId,
      name,
      source: "recipe",
      servingSizeGrams: totalWeightGrams / servings,
      servingName: "1 serving",
      caloriesPer100g: totals.calories * factor,
      proteinPer100g: totals.protein * factor,
      carbsPer100g: totals.carbs * factor,
      fatPer100g: totals.fat * factor,
      fiberPer100g: totals.fiber * factor,
      sugarPer100g: totals.sugar * factor,
      saturatedFatPer100g: totals.saturatedFat * factor,
      sodiumMgPer100g: totals.sodiumMg * factor,
      createdAt: now,
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
}
