import type { foods } from "../db/schema.js";

type FoodRow = typeof foods.$inferSelect;

export interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  saturatedFat: number;
  sodiumMg: number;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function scaleNutrition(food: FoodRow, quantityGrams: number): NutritionTotals {
  const factor = quantityGrams / 100;
  return {
    calories: round(food.caloriesPer100g * factor),
    protein: round(food.proteinPer100g * factor),
    carbs: round(food.carbsPer100g * factor),
    fat: round(food.fatPer100g * factor),
    fiber: round((food.fiberPer100g ?? 0) * factor),
    sugar: round((food.sugarPer100g ?? 0) * factor),
    saturatedFat: round((food.saturatedFatPer100g ?? 0) * factor),
    sodiumMg: round((food.sodiumMgPer100g ?? 0) * factor),
  };
}

export const EMPTY_NUTRITION: NutritionTotals = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  sugar: 0,
  saturatedFat: 0,
  sodiumMg: 0,
};

export function sumNutrition(list: NutritionTotals[]): NutritionTotals {
  return list.reduce(
    (acc, n) => ({
      calories: round(acc.calories + n.calories),
      protein: round(acc.protein + n.protein),
      carbs: round(acc.carbs + n.carbs),
      fat: round(acc.fat + n.fat),
      fiber: round(acc.fiber + n.fiber),
      sugar: round(acc.sugar + n.sugar),
      saturatedFat: round(acc.saturatedFat + n.saturatedFat),
      sodiumMg: round(acc.sodiumMg + n.sodiumMg),
    }),
    { ...EMPTY_NUTRITION }
  );
}
