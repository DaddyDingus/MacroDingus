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
// would mean constant migrations for a NULL-heavy schema. The fat-subtype
// columns below are the one deliberate exception to that rule: they're a
// small, closed set (there's no "more fat subtypes" the way there's always
// another obscure vitamin), and omega-3/omega-6 specifically were asked for
// as first-class tracked nutrients rather than buried in the opaque blob.
export const foods = sqliteTable("foods", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  brand: text("brand"),
  barcode: text("barcode"),
  source: text("source").notNull().default("custom"), // 'custom' | 'openfoodfacts' | 'recipe' | 'ai_estimate' | 'afcd'
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
  monounsaturatedFatPer100g: real("monounsaturated_fat_per_100g"),
  polyunsaturatedFatPer100g: real("polyunsaturated_fat_per_100g"),
  omega3Per100g: real("omega_3_per_100g"),
  omega6Per100g: real("omega_6_per_100g"),
  transFatPer100g: real("trans_fat_per_100g"),
  microsJson: text("micros_json"),
  // Same {key: grams-per-100g} JSON-blob convention as microsJson, kept as
  // separate columns rather than folded into it purely for read-side
  // clarity (FoodDetailScreen renders them as distinct sections) — 18 amino
  // acids and a curated set of carb subtypes (fructose/glucose/sucrose/
  // lactose/maltose/galactose/starch) both fall on the "open-ended set, JSON
  // blob" side of this file's own rule above, same reasoning as
  // microsJson itself. Populated by scripts/import-afcd-foods.ts (Australian
  // Food Composition Database) — sparse by design like microsJson, since
  // AFCD only lab-tested amino acids for a subset of its foods.
  aminoAcidsJson: text("amino_acids_json"),
  carbDetailJson: text("carb_detail_json"),
  // A user-picked emoji for a custom food or recipe — null means "no
  // override", so FoodIconAvatar falls back to its keyword-based guess
  // (see lib/foodEmoji.ts's getFoodIcon). OpenFoodFacts imports never set
  // this; only the Create Food/Recipe forms do.
  icon: text("icon"),
  // Set once a food is "deleted" while still referenced by a log entry or a
  // deleted recipe's history — never actually removed (that would corrupt
  // every log/copy-day entry pointing at it, since nutrition is always
  // computed live from this row, never snapshotted onto the log), just
  // excluded from every browse/pick surface (search, Library, Favorites,
  // Describe's match candidates). Also set immediately at creation for every
  // `ai_estimate` food from the Describe tab — those are never meant to be
  // reusable/visible, only to back the specific log entry(ies) that used
  // them. Null means visible everywhere as normal.
  hiddenAt: text("hidden_at"),
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
  // Optional — entered occasionally (Navy tape/calipers/BIA scale), not part
  // of the daily weigh-in habit. Most recent non-null value is what protein
  // targeting uses (see shared.ts's mostRecentBodyFatPercent), not a trend.
  bodyFatPercent: real("body_fat_percent"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  userDateIdx: uniqueIndex("weights_user_date_idx").on(table.userId, table.date),
}));

// Inputs to the initial (pre-data) TDEE estimate and the macro split formula.
// birthYear rather than a full DOB — age-in-years is all the Mifflin-St Jeor
// estimate needs, and it's one less thing to ask for.
// Body/lifestyle stats only — goal and macro-split data live in
// goals/programs/program_days (see below); this used to also hold
// goalType/targetRateKgPerWeek/proteinPerKg/fatPercent/goalWeightKg/
// goalStartedAt/goalStartWeightKg inline, backfilled into those tables by
// scripts/backfill-goals-programs.ts (since removed — one-time migration,
// done its job) before this Phase 2 migration dropped the columns. Used as
// Mifflin-St Jeor inputs when there isn't yet enough weight+logging history
// for the adaptive TDEE estimate to kick in.
export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey().references(() => users.id),
  sex: text("sex").notNull(), // 'male' | 'female'
  birthYear: integer("birth_year").notNull(),
  heightCm: real("height_cm").notNull(),
  activityLevel: text("activity_level").notNull(), // sedentary|light|moderate|active|very_active
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  // Weekday (0=Sunday..6=Saturday, matches JS Date.getDay()) the "Change
  // Check-In Day" setting is pinned to — null means no fixed day chosen yet,
  // in which case the Strategy screen's ring falls back to a rolling 7-day
  // cycle from the last check-in.
  checkInDayOfWeek: integer("check_in_day_of_week"),
  // Hours/week of high-intensity exercise — selects MacroFactor BMR formula:
  // ≥7h → Formula 3 (athlete, FFM only); any BF% on file → Formula 2 (body
  // comp); fallback → Formula 1 (height/weight).
  weeklyExerciseHours: real("weekly_exercise_hours"),
  // Set once, the moment a user's first-ever goal is created (see
  // POST /api/goals) — never re-derived, never cleared except by the
  // account-reset flow deleting this whole row. App.tsx's onboarding gate
  // reads this instead of inferring "done" from live weights/goal state, so
  // a user who deletes their only weigh-in (trendWeightKg briefly null) or
  // is temporarily between goals isn't bounced back into OnboardingFlow.
  onboardingCompletedAt: text("onboarding_completed_at"),
});

// A goal is WHAT you want (target weight + rate), separate from a Program
// (HOW you'll get there — see below). Historical and re-openable: at most
// one row per user has endedAt === null (the active goal); creating a new
// goal closes out whichever one was active, and "Reopen Previous Goal"
// clears endedAt on an old row after closing the current one. This replaces
// the goalType/targetRateKgPerWeek/goalWeightKg/goalStartedAt/
// goalStartWeightKg fields that used to live directly on `profiles` — a
// single profile row can't hold history, and the Strategy redesign needs a
// real "Goal History" list plus true edit-in-place / reopen semantics.
export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  goalType: text("goal_type").notNull(), // cut|bulk|maintain
  goalWeightKg: real("goal_weight_kg"), // null for maintain
  targetRateKgPerWeek: real("target_rate_kg_per_week").notNull(),
  startedAt: text("started_at").notNull(),
  // Trend weight at the moment this goal was created — same role
  // profiles.goalStartWeightKg used to play, via the same currentTrendKg()
  // helper, just snapshotted once per goal row instead of once per profile.
  startWeightKg: real("start_weight_kg"),
  endedAt: text("ended_at"), // null = currently active
  createdAt: text("created_at").notNull(),
}, (table) => ({
  userStartedIdx: index("goals_user_started_idx").on(table.userId, table.startedAt),
}));

// A program is HOW you'll reach the active goal — the actual calorie/macro
// targets, potentially different per weekday (see program_days). Also
// historical (endedAt === null marks the active one) so "Coached Program /
// 23 May – Now" can show a real start date independent of the goal's own
// start date (a program can be regenerated or replaced without touching the
// goal underneath it).
export const programs = sqliteTable("programs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  goalId: text("goal_id").notNull().references(() => goals.id),
  style: text("style").notNull(), // 'coached' | 'manual' (not a DB enum — SQLite has none; 'collaborative' can be added later with no migration)
  dietType: text("diet_type"), // 'balanced'|'low_fat'|'low_carb'|'keto' — null for manual
  calorieFloorKcal: real("calorie_floor_kcal"), // resolved number (1200 or 800) — null for manual
  proteinLevel: text("protein_level"), // 'low'|'moderate'|'high'|'extra_high'|'custom' — null for manual
  proteinPerKgUsed: real("protein_per_kg_used"), // resolved g/kg actually applied, coached or manual
  // User-supplied "starting Calories" from the wizard's Calories step, back-
  // solved into an implied TDEE (see routes/programs.ts) — null when the
  // wizard's own formula estimate was used instead. Fills the same fallback
  // slot the formula estimate would (generateCoachedProgramDays: adaptive ??
  // initialTdeeOverrideKcal ?? formulaTdee), so it seeds check-ins/regenerate
  // until estimateAdaptiveTdee has enough real logging data to take over on
  // its own — never touched again after that point, by design. Null for manual.
  initialTdeeOverrideKcal: real("initial_tdee_override_kcal"),
  // 'total' | 'lean' — whether proteinPerKgUsed is applied against total
  // trend weight or estimated lean body mass (needs a body-fat % on file;
  // falls back to total if none). Defaults 'total' so existing programs are
  // unaffected. Not meaningful for manual (stored as 'total', unused).
  proteinBasis: text("protein_basis").notNull().default("total"),
  // 'even' | 'shifted' | 'custom' — 'custom' means at least one day has been
  // hand-edited via Edit Program; performCheckin() skips regenerating a
  // program's targets once it's 'custom', so a check-in never silently
  // overwrites a manual per-day tweak.
  distributionMode: text("distribution_mode").notNull(),
  // JSON array of day-of-week ints (0=Sun..6=Sat) the user picked as
  // "higher calorie" days when distributionMode is 'shifted' — e.g.
  // "[0,6]". Null for 'even'/'custom', or for a 'shifted' program that
  // predates this field (generateCoachedProgramDays falls back to weekend
  // in that case — see DEFAULT_SHIFTED_HIGH_DAYS in engine/program.ts).
  shiftedHighDays: text("shifted_high_days"),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"), // null = currently active
  createdAt: text("created_at").notNull(),
}, (table) => ({
  userStartedIdx: index("programs_user_started_idx").on(table.userId, table.startedAt),
}));

// Always exactly 7 rows per program, even when every day is identical
// ('even' distribution) — uniform storage rather than sparse
// same-value-implied-for-missing-days special-casing, same reasoning
// GET /api/logs/history's dense zero-fill already uses.
export const programDays = sqliteTable("program_days", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => programs.id),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sunday..6=Saturday, matches JS Date.getDay()
  targetCalories: real("target_calories").notNull(),
  targetProteinG: real("target_protein_g").notNull(),
  targetCarbsG: real("target_carbs_g").notNull(),
  targetFatG: real("target_fat_g").notNull(),
}, (table) => ({
  programDayIdx: uniqueIndex("program_days_program_day_idx").on(table.programId, table.dayOfWeek),
}));

// A check-in is purely a TDEE-estimate snapshot — targets (which can vary
// by weekday) live in program_days instead; this used to also hold
// targetCalories/targetProteinG/targetCarbsG/targetFatG inline, until a
// single flat set of columns on one row couldn't represent per-weekday
// targets anymore. The Expenditure screen's Flux Range/Current Strategy
// tile logic reads only tdee/usedAdaptiveTdee/tdeeFluxKcal below, so none
// of that was affected by targets moving out.
export const checkins = sqliteTable("checkins", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  date: text("date").notNull(),
  tdee: real("tdee").notNull(),
  trendWeightKg: real("trend_weight_kg").notNull(),
  // Whether this check-in's TDEE came from estimateAdaptiveTdee() (real
  // weight-trend + logged-calorie data) or the mifflinStJeorTdee() formula
  // fallback — computed transiently in performCheckin() before this column
  // existed, now persisted so the Expenditure screen's "Current Strategy"
  // tile and history list can show it after the fact. Nullable rather than
  // backfilled: pre-migration check-ins genuinely don't have this recorded,
  // and re-deriving it after the fact wouldn't reflect what was actually
  // used at check-in time — null means "not tracked yet", not "false".
  usedAdaptiveTdee: integer("used_adaptive_tdee", { mode: "boolean" }),
  // ± range around `tdee` for this check-in, from estimateAdaptiveTdee()'s
  // AdaptiveTdeeEstimate.fluxKcal (stddev of the window's own daily logged
  // calories — see that function's doc comment for why this, not a
  // fabricated confidence interval, is what backs the Expenditure screen's
  // "Flux Range" band). Null whenever usedAdaptiveTdee is false/null: a
  // formula estimate has no underlying data variance to measure.
  tdeeFluxKcal: real("tdee_flux_kcal"),
  // Short, deliberately unencouraging factual summary of the period since
  // the previous check-in (see engine/checkinNarrative.ts) — generated
  // best-effort inside performCheckin() alongside the TDEE snapshot above,
  // so it rides the same weekly cadence rather than a separate schedule.
  // Null when ANTHROPIC_API_KEY isn't configured, generation failed, or
  // this check-in predates the feature — the Dashboard tile and journal
  // screen both just omit a checkin with no narrative rather than fake one.
  narrative: text("narrative"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  userDateIdx: index("checkins_user_date_idx").on(table.userId, table.date),
}));

export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  date: text("date").notNull(),
  filename: text("filename").notNull(),
  // Nullable progress-photo pose for ghost alignment/comparison. The legacy
  // 'front' | 'side' | 'back' values are the relaxed variants; the flexed
  // variants add a `_flexed` suffix. Null means an older, uncategorized photo
  // (or a one-off shot), still shown in history but excluded from comparison.
  pose: text("pose"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  userDateIdx: index("photos_user_date_idx").on(table.userId, table.date),
}));

// One row per (user, date, body part) — always cm, same "canonical unit,
// convert at the display boundary" convention as weightKg. Saving the
// Measurements form re-upserts every touched part for that date rather than
// appending, so re-editing a day's log doesn't pile up duplicate rows.
export const measurements = sqliteTable("measurements", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  date: text("date").notNull(),
  part: text("part").notNull(),
  valueCm: real("value_cm").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  userDateIdx: index("measurements_user_date_idx").on(table.userId, table.date),
}));

// Per-user, not shared like `foods` itself — favoriting is a personal
// shortcut list, not a property of the food. Unique on (userId, foodId) so
// favoriting an already-favorited food is a no-op rather than a duplicate row.
export const favorites = sqliteTable("favorites", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  foodId: text("food_id").notNull().references(() => foods.id),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  userFoodIdx: uniqueIndex("favorites_user_food_idx").on(table.userId, table.foodId),
}));

// One JSON blob per user for loosely-related UI preferences (theme, units,
// dashboard shortcuts/colors, dashboard tile layout) that used to live only
// in localStorage — a fresh install (new origin, e.g. after moving macrotrack
// to its own Tailscale hostname) starts with empty localStorage and silently
// lost all of these. A single JSON column (rather than one column per
// preference) means adding a new synced preference later is a frontend-only
// change, no migration required. Deliberately does NOT include the barcode
// scanner's saved camera lens (localStorage-only, `BarcodeScanner.tsx`) —
// that's a physical-hardware preference tied to one specific device's camera
// IDs, and syncing it would silently break scanning on any other device.
export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey().references(() => users.id),
  settingsJson: text("settings_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull(),
});
