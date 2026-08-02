// One-time bulk seed of the household's local `foods` table from the
// Australian Food Composition Database (AFCD Release 3, FSANZ) — fixes
// common staples (e.g. "honey") returning unusable OpenFoodFacts search
// results by giving local search something real to match first (see
// routes/foods.ts: local `foods` rows always return before OFF is even
// queried). Input is a pre-transformed JSON array (already mapped/unit-
// converted from AFCD's raw .xlsx export — see the mapping table in this
// project's macrotrack plan history) placed in DATA_DIR, not committed to
// the repo — this script is meant to run once, not to be re-run as part of
// normal operation.
//
// Usage: docker exec macrotrack node dist/scripts/import-afcd-foods.js [path-to-json]
//   defaults to DATA_DIR/afcd-import.json
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { foods } from "../db/schema.js";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const jsonPath = process.argv[2] ?? path.join(DATA_DIR, "afcd-import.json");

if (!fs.existsSync(jsonPath)) {
  console.error(`Not found: ${jsonPath}`);
  process.exit(1);
}

interface AfcdFood {
  name: string;
  source: string;
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
  aminoAcidsJson: string | null;
  carbDetailJson: string | null;
  createdAt: string;
}

const entries: AfcdFood[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
console.log(`Read ${entries.length} foods from ${jsonPath}.`);

let inserted = 0;
let skipped = 0;

// better-sqlite3 transactions must be synchronous (it throws if the callback
// returns a promise) — its own execution is synchronous under the hood
// regardless of the awaitable API `db.select()`/`db.insert()` normally
// present elsewhere in this codebase, so `.all()`/`.run()` are used here
// instead of `await` to stay inside that constraint.
db.transaction((tx) => {
  for (const row of entries) {
    const existing = tx.select({ id: foods.id }).from(foods).where(eq(foods.name, row.name)).all();
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    tx.insert(foods).values({ id: randomUUID(), ...row }).run();
    inserted++;
  }
});

console.log(`Inserted ${inserted}, skipped ${skipped} (already present by name).`);
