export interface Food {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  source: "custom" | "openfoodfacts" | "recipe";
  servingSizeGrams: number | null;
  servingName: string | null;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number | null;
  sugarPer100g: number | null;
  saturatedFatPer100g: number | null;
  sodiumMgPer100g: number | null;
  monounsaturatedFatPer100g: number | null;
  polyunsaturatedFatPer100g: number | null;
  omega3Per100g: number | null;
  omega6Per100g: number | null;
  transFatPer100g: number | null;
  microsJson: string | null;
  createdAt: string;
}

export interface Nutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  saturatedFat: number;
  sodiumMg: number;
}

export interface LogEntry {
  id: string;
  quantityGrams: number;
  loggedAt: string;
  food: Food;
  nutrition: Nutrition;
}

export interface DayLog {
  date: string;
  entries: LogEntry[];
  totals: Nutrition;
}

export interface CreateFoodInput {
  name: string;
  brand?: string;
  barcode?: string;
  servingSizeGrams?: number;
  servingName?: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g?: number;
  sugarPer100g?: number;
  saturatedFatPer100g?: number;
  sodiumMgPer100g?: number;
  monounsaturatedFatPer100g?: number;
  polyunsaturatedFatPer100g?: number;
  omega3Per100g?: number;
  omega6Per100g?: number;
  transFatPer100g?: number;
  // Same shape/keys as OpenFoodFacts imports (see backend's MICRO_KEYS) —
  // the backend serializes this straight into the foods.microsJson column.
  micros?: Record<string, number>;
}

export interface CreateRecipeInput {
  name: string;
  servings: number;
  totalWeightGrams?: number;
  ingredients: { foodId: string; quantityGrams: number }[];
}
