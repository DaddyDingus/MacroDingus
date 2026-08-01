import type { Food, Nutrition } from "../api/types";

const round = (n: number) => Math.round(n * 10) / 10;

// Mirrors the backend's scaling formula so the add-food sheet can preview
// numbers instantly, before the server round-trip confirms them.
const ZERO: Nutrition = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  sugar: 0,
  saturatedFat: 0,
  sodiumMg: 0,
};

export function sumNutrition(list: Nutrition[]): Nutrition {
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
    { ...ZERO }
  );
}

// Un-counts an entry's own nutrition from a running total — used when editing
// an already-logged entry through FoodDetailScreen, whose "Impact on
// Targets" rings need the budget as it stood *before* this entry, not the
// day total that already includes its current (about-to-change) quantity.
export function subtractNutrition(base: Nutrition, minus: Nutrition): Nutrition {
  return {
    calories: Math.max(0, round(base.calories - minus.calories)),
    protein: Math.max(0, round(base.protein - minus.protein)),
    carbs: Math.max(0, round(base.carbs - minus.carbs)),
    fat: Math.max(0, round(base.fat - minus.fat)),
    fiber: Math.max(0, round(base.fiber - minus.fiber)),
    sugar: Math.max(0, round(base.sugar - minus.sugar)),
    saturatedFat: Math.max(0, round(base.saturatedFat - minus.saturatedFat)),
    sodiumMg: Math.max(0, round(base.sodiumMg - minus.sodiumMg)),
  };
}

export function scaleNutrition(food: Food, quantityGrams: number): Nutrition {
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
