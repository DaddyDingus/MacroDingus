import { sqliteTable, text, real, index } from "drizzle-orm/sqlite-core";

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
  source: text("source").notNull().default("custom"), // 'custom' | 'openfoodfacts'
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

export const logs = sqliteTable("logs", {
  id: text("id").primaryKey(),
  date: text("date").notNull(), // YYYY-MM-DD — the day it's logged to, as chosen by the client
  meal: text("meal").notNull(), // breakfast | lunch | dinner | snacks
  foodId: text("food_id").notNull().references(() => foods.id),
  quantityGrams: real("quantity_grams").notNull(),
  loggedAt: text("logged_at").notNull(), // ISO timestamp — drives smart-history time-of-day ranking
  createdAt: text("created_at").notNull(),
}, (table) => ({
  dateIdx: index("logs_date_idx").on(table.date),
  foodIdx: index("logs_food_idx").on(table.foodId),
}));
