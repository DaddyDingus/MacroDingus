// One-off backfill: adds Small/Medium/Large/Extra Large/Jumbo measures to the
// AFCD-seeded whole-egg entries (see import-afcd-foods.ts). AFCD's own import
// left every food with zero measures — grams-only — which is correct default
// behavior per this project's "never infer weights from food names" rule
// (routes/foods.ts, foodMeasures.ts). Eggs are a deliberate, documented
// exception to that rule: unlike a guessed cup/slice weight, egg size
// grading is a real regulated standard, not an inference from the name.
//
// These gram figures are still a composed ESTIMATE, not one verified source:
//   - AU carton grading (whole egg, shell included): Medium 43g, Large 52g,
//     Extra Large 60g, Jumbo 68g.
//   - AFCD nutrition is per 100g EDIBLE portion (shell excluded, confirmed
//     general AFCD convention, not egg-specific).
//   - Shell is ~10-11% of whole-egg weight (USDA Egg-Grading Manual), so
//     edible portion is taken as 89% of the carton-grade weight.
// If more accurate figures ever surface (a real edible-portion reference, or
// the household's own kitchen-scale measurement of a shelled egg), replace
// EDIBLE_GRAMS_BY_LABEL below rather than re-deriving from scratch.
//
// Applied only to "whole egg" preparations where the size assumption still
// makes sense (raw/poached/boiled/fried, plain or omega-3 enriched) — NOT to
// yolk-only, white-only, or the milk-mixed scrambled entry, since none of
// those correspond to "one egg" by count.
//
// Idempotent: re-running always overwrites to the current EDIBLE_GRAMS_BY_LABEL
// values rather than skipping, so a future correction just means running it
// again.
//
// Usage: docker exec macrotrack node dist/scripts/backfill-egg-measures.js
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { foods } from "../db/schema.js";

const SHELL_FRACTION = 0.11;
const CARTON_GRAMS_BY_LABEL: Record<string, number> = {
  "medium egg": 43,
  "large egg": 52,
  "extra large egg": 60,
  "jumbo egg": 68,
};

const EDIBLE_GRAMS_BY_LABEL = Object.fromEntries(
  Object.entries(CARTON_GRAMS_BY_LABEL).map(([label, cartonGrams]) => [label, Math.round(cartonGrams * (1 - SHELL_FRACTION))])
);

const EGG_FOOD_NAMES = [
  "Egg, chicken, whole, raw",
  "Egg, chicken, whole, poached",
  "Egg, chicken, whole, hard-boiled",
  "Egg, chicken, whole, fried, no fat added",
  "Egg, chicken, whole, omega-3 polyunsaturate enriched, raw",
  "Egg, chicken, whole, omega-3 polyunsaturate enriched, boiled",
];

const measuresJson = JSON.stringify(Object.entries(EDIBLE_GRAMS_BY_LABEL).map(([name, grams]) => ({ name, grams })));

let updated = 0;
db.transaction((tx) => {
  for (const name of EGG_FOOD_NAMES) {
    const result = tx.update(foods).set({ measuresJson }).where(eq(foods.name, name)).run();
    if (result.changes > 0) updated++;
  }
});

console.log(`Updated ${updated}/${EGG_FOOD_NAMES.length} egg foods with measures:`, EDIBLE_GRAMS_BY_LABEL);
