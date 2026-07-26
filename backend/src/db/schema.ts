import { sqliteTable, text, real, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// One household, a handful of people, each with their own log/weight/coaching
// data. Seeded from the AUTH_USERS env var at boot (see auth.ts) rather than
// a signup flow — this is a closed personal deployment, not a public app.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull(),
});

// Nutrient fields that appear on essentially every real-world label live as
// first-class columns since Phase 1 UI and Phase 6 analytics both need to
// query/sum them directly. Rarer micros (vitamins, minerals, cholesterol)
// go in microsJson as {key: grams-per-100g-equivalent} — OpenFoodFacts (Phase 2)
// reports wildly inconsistent subsets of these, so a fixed column per nutrient
// would mean constant migrations for a NULL-heavy schema.
export const foods = sqliteTable("foods", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  brand: text("brand"),
  barcode: text("barcode"),
  source: text("source").notNull().default("custom"), // 'custom' | 'openfoodfacts' | 'recipe'
  servingSizeGrams: real("serving_size_grams"),
  servingName: text("serving_name"),
  caloriesPer100g: real("calories_per_100g").notNull(),
  proteinPer100g: real("protein_per_100g").notNull(),
  carbsPer100g: real("carbs_per_100g").notNull(),
  fatPer100g: real("fat_per_100g").notNull(),
  fiberPer100g: real("fiber_per_100g"),
  sugarPer100g: real("sugar_per_100g"),
  saturatedFatPer100g: real("saturated_fat_per_100g"),
  sodiumMgPer100g: real("sodium_mg_per_100g"),
  microsJson: text("micros_json"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  nameIdx: index("foods_name_idx").on(table.name),
  barcodeIdx: index("foods_barcode_idx").on(table.barcode),
}));

// A recipe is materialized as a normal `foods` row (source: 'recipe') whose
// per-100g values are computed from its ingredients — logging a recipe is
// then just logging any other food (by serving via servingSizeGrams, or by
// weighing out any gram amount), with zero special-casing anywhere in the
// logging path. `totalWeightGrams` is stored separately from the ingredient
// sum because cooking changes weight (water loss/gain) without changing the
// total calories — nutrition-per-gram of the finished product depends on the
// real final weight, not the sum of raw ingredient weights.
export const recipes = sqliteTable("recipes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id), // recipe metadata is personal; the resulting food is shared
  foodId: text("food_id").notNull().references(() => foods.id),
  name: text("name").notNull(),
  totalWeightGrams: real("total_weight_grams").notNull(),
  servings: real("servings").notNull(),
  createdAt: text("created_at").notNull(),
});

export const recipeIngredients = sqliteTable("recipe_ingredients", {
  id: text("id").primaryKey(),
  recipeId: text("recipe_id").notNull().references(() => recipes.id),
  foodId: text("food_id").notNull().references(() => foods.id),
  quantityGrams: real("quantity_grams").notNull(),
});

export const logs = sqliteTable("logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id), // foods are shared; logs are per-person
  date: text("date").notNull(), // YYYY-MM-DD — the day it's logged to, as chosen by the client
  foodId: text("food_id").notNull().references(() => foods.id),
  quantityGrams: real("quantity_grams").notNull(),
  loggedAt: text("logged_at").notNull(), // ISO timestamp — drives smart-history time-of-day ranking
  createdAt: text("created_at").notNull(),
}, (table) => ({
  dateIdx: index("logs_date_idx").on(table.date),
  foodIdx: index("logs_food_idx").on(table.foodId),
  userDateIdx: index("logs_user_date_idx").on(table.userId, table.date),
}));

// One scale reading per person per day — re-weighing the same day upserts
// rather than creating a second entry. Trend weight (EWMA over this) is
// computed on read, not stored, so it always reflects the full corrected
// history rather than an incrementally-updated value that could drift.
export const weights = sqliteTable("weights", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  date: text("date").notNull(),
  weightKg: real("weight_kg").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  userDateIdx: uniqueIndex("weights_user_date_idx").on(table.userId, table.date),
}));

// Inputs to the initial (pre-data) TDEE estimate and the macro split formula.
// birthYear rather than a full DOB — age-in-years is all the Mifflin-St Jeor
// estimate needs, and it's one less thing to ask for.
export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey().references(() => users.id),
  sex: text("sex").notNull(), // 'male' | 'female'
  birthYear: integer("birth_year").notNull(),
  heightCm: real("height_cm").notNull(),
  activityLevel: text("activity_level").notNull(), // sedentary|light|moderate|active|very_active
  goalType: text("goal_type").notNull(), // cut|bulk|maintain
  targetRateKgPerWeek: real("target_rate_kg_per_week").notNull(), // negative=cut, positive=bulk, 0=maintain
  // Macro split inputs — protein anchored to trend bodyweight, fat as a share
  // of total calories, carbs always absorb whatever's left. Defaults match
  // what was hardcoded before this became adjustable (2.0 g/kg, 25% fat).
  proteinPerKg: real("protein_per_kg").notNull().default(2.0),
  fatPercent: real("fat_percent").notNull().default(0.25),
  // Goal Progress needs a target and a stable "start" point to measure
  // against. goalStartedAt/goalStartWeightKg snapshot the trend weight at
  // the moment goalWeightKg is set or changed (see coach.ts), so progress is
  // always relative to the specific goal in effect, not a stale first-ever
  // weigh-in from a previous goal.
  goalWeightKg: real("goal_weight_kg"),
  goalStartedAt: text("goal_started_at"),
  goalStartWeightKg: real("goal_start_weight_kg"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// A check-in snapshots the targets that apply from that date until the next
// one — daily targets are always "whatever the latest check-in produced,"
// not recalculated live on every page load, so they stay stable day to day
// the way MacroFactor's actually behave (a jump only happens when you
// deliberately check in, not silently overnight).
export const checkins = sqliteTable("checkins", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  date: text("date").notNull(),
  tdee: real("tdee").notNull(),
  targetCalories: real("target_calories").notNull(),
  targetProteinG: real("target_protein_g").notNull(),
  targetCarbsG: real("target_carbs_g").notNull(),
  targetFatG: real("target_fat_g").notNull(),
  trendWeightKg: real("trend_weight_kg").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  userDateIdx: index("checkins_user_date_idx").on(table.userId, table.date),
}));

export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  date: text("date").notNull(),
  filename: text("filename").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  userDateIdx: index("photos_user_date_idx").on(table.userId, table.date),
}));
