export interface Food {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  source: "custom" | "openfoodfacts" | "recipe" | "ai_estimate" | "afcd";
  servingSizeGrams: number | null;
  servingName: string | null;
  measuresJson?: string | null;
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
  // Same {key: grams-per-100g} shape as microsJson — see schema.ts. Sparse:
  // AFCD (the only current source for these) only lab-tested amino acids
  // for a subset of its foods, so most foods have at most a couple of these
  // 18 keys populated, some none at all.
  aminoAcidsJson: string | null;
  // Curated subset of carb subtypes (fructose/glucose/sucrose/lactose/
  // maltose/galactose/starch) — also AFCD-sourced, same sparse convention.
  carbDetailJson: string | null;
  icon: string | null;
  // Non-null means this food is "deleted" (or an ai_estimate Describe row) —
  // kept alive server-side only to back existing log entries; the backend
  // already excludes hidden foods from every search/browse/favorites
  // response, so the frontend never needs to check this field itself.
  hiddenAt: string | null;
  createdAt: string;
  // Only present on `source: 'recipe'` foods with no custom `icon` — up to 3
  // ingredients (name + their own icon override) for RecipeIconStack to
  // render as a collage in place of a single generic avatar. Attached by
  // GET /api/logs (see attachIngredientPreviews); absent everywhere else.
  ingredientPreview?: { name: string; icon: string | null }[];
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
  incomplete: boolean;
}

export interface CreateFoodInput {
  name: string;
  brand?: string;
  barcode?: string;
  servingSizeGrams?: number;
  servingName?: string;
  measures?: { name: string; grams: number }[];
  icon?: string | null;
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

// Response shape of POST /api/foods/scan-label (backend/src/engine/labelScan.ts).
// Every field is nullable: the model returns null for anything it can't read
// off the label rather than guess, so CreateFoodForm only overwrites the
// fields that came back non-null and leaves the rest exactly as the user had
// them (blank, or already hand-typed).
export interface LabelScanResult {
  name: string | null;
  brand: string | null;
  servingSizeGrams: number | null;
  servingName: string | null;
  caloriesPer100g: number | null;
  proteinPer100g: number | null;
  carbsPer100g: number | null;
  fatPer100g: number | null;
  fiberPer100g: number | null;
  sugarPer100g: number | null;
  saturatedFatPer100g: number | null;
  sodiumMgPer100g: number | null;
}

// Response shape of POST /api/foods/describe-meal (backend/src/engine/describeMeal.ts).
// Each `food` is already a real, persisted row by the time this comes back —
// either an existing library match reused as-is, or a freshly created
// `source: 'ai_estimate'` food — so the frontend can stage it straight onto
// the plate exactly like a search result, no separate "materialize" step.
export interface DescribedMealItem {
  food: Food;
  quantityGrams: number;
  servingDescription: string | null;
}

// Response shape of POST /api/recipes/import-url (backend/src/engine/recipeImport.ts).
// Same "already-real foods rows" contract as DescribedMealItem above — never
// auto-saved as a recipe itself, just handed to RecipeForm's `initial` prop
// as a reviewable, still-editable draft.
export interface ImportedRecipeResult {
  name: string;
  servings: number;
  totalWeightGrams: number | null;
  ingredients: { food: Food; quantityGrams: number }[];
}

export interface CreateRecipeInput {
  name: string;
  icon?: string | null;
  servings: number;
  totalWeightGrams?: number;
  ingredients: { foodId: string; quantityGrams: number }[];
}
