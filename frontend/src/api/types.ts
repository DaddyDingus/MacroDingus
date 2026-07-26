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
}

export interface CreateRecipeInput {
  name: string;
  servings: number;
  totalWeightGrams?: number;
  ingredients: { foodId: string; quantityGrams: number }[];
}
