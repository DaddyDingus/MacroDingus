import type { Food } from "../api/types";

export interface FoodMeasure {
  name: string;
  grams: number;
}

export function foodMeasures(food: Pick<Food, "measuresJson" | "servingName" | "servingSizeGrams">): FoodMeasure[] {
  const measures: FoodMeasure[] = [];
  if (food.measuresJson) {
    try {
      const parsed = JSON.parse(food.measuresJson) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "object" && item !== null && typeof item.name === "string" && typeof item.grams === "number" && item.grams > 0) {
            measures.push({ name: item.name.trim(), grams: item.grams });
          }
        }
      }
    } catch {
      // A malformed optional measure list must never make the food unusable.
    }
  }
  if (food.servingSizeGrams) {
    measures.unshift({ name: food.servingName?.trim() || "serving", grams: food.servingSizeGrams });
  }
  const seen = new Set<string>();
  return measures.filter((measure) => {
    const key = `${measure.name.toLowerCase()}::${measure.grams}`;
    if (!measure.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
