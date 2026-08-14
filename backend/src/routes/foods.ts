import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, like, desc, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { foods, logs, foodSearchStats } from "../db/schema.js";
import { fetchOffProduct, mapOffProduct, offCaloriesPer100g, searchOffProducts } from "../engine/openfoodfacts.js";
import { scanNutritionLabel } from "../engine/labelScan.js";
import { describeMeal } from "../engine/describeMeal.js";
import { aiTaskConfigured } from "../engine/aiProvider.js";
import { toBoundedJpeg } from "../engine/imagePrep.js";
import { expandFoodQuery, foodTextRelevance, normalizeFoodQuery } from "../engine/foodSearch.js";

// Same long-edge cap/quality tradeoff as photos.ts's progress-photo resize —
// a nutrition label's print is small, so this stays notably larger than that
// 1600px (fine detail matters here, whereas a body photo doesn't need it).
const LABEL_MAX_DIMENSION = 2000;
const LABEL_JPEG_QUALITY = 90;

// A plate photo needs to be sharp enough to tell foods apart and judge
// portion size, not to read fine print — closer to photos.ts's own
// progress-photo bound than the label scanner's.
const PLATE_PHOTO_MAX_DIMENSION = 1600;
const PLATE_PHOTO_JPEG_QUALITY = 85;

const foodInput = z.object({
  name: z.string().min(1),
  brand: z.string().optional(),
  barcode: z.string().optional(),
  servingSizeGrams: z.number().positive().optional(),
  servingName: z.string().optional(),
  measures: z.array(z.object({ name: z.string().trim().min(1).max(40), grams: z.number().positive().max(10000) })).max(12).optional(),
  // A user-picked emoji override — null clears back to the keyword-guessed
  // icon (see frontend lib/foodEmoji.ts), omitted leaves it untouched.
  icon: z.string().nullable().optional(),
  caloriesPer100g: z.number().nonnegative(),
  proteinPer100g: z.number().nonnegative(),
  carbsPer100g: z.number().nonnegative(),
  fatPer100g: z.number().nonnegative(),
  fiberPer100g: z.number().nonnegative().optional(),
  sugarPer100g: z.number().nonnegative().optional(),
  saturatedFatPer100g: z.number().nonnegative().optional(),
  sodiumMgPer100g: z.number().nonnegative().optional(),
  monounsaturatedFatPer100g: z.number().nonnegative().optional(),
  polyunsaturatedFatPer100g: z.number().nonnegative().optional(),
  omega3Per100g: z.number().nonnegative().optional(),
  omega6Per100g: z.number().nonnegative().optional(),
  transFatPer100g: z.number().nonnegative().optional(),
  // Vitamins/minerals a custom food is entered with — same shape/keys as
  // OpenFoodFacts imports produce (see openfoodfacts.ts's MICRO_KEYS), just
  // serialized into the same microsJson column server-side rather than
  // getting their own columns (schema.ts explains why: an open-ended,
  // NULL-heavy set isn't worth a column each).
  micros: z.record(z.string(), z.number().nonnegative()).optional(),
});

function microsJsonFromInput(micros: Record<string, number> | undefined): string | null | undefined {
  if (micros === undefined) return undefined;
  return Object.keys(micros).length > 0 ? JSON.stringify(micros) : null;
}

function measuresJsonFromInput(measures: { name: string; grams: number }[] | undefined): string | null | undefined {
  if (measures === undefined) return undefined;
  const unique = new Map<string, { name: string; grams: number }>();
  for (const measure of measures) unique.set(measure.name.trim().toLowerCase(), { name: measure.name.trim(), grams: measure.grams });
  return unique.size > 0 ? JSON.stringify([...unique.values()]) : null;
}

function localFoodCondition(query: string) {
  const terms = expandFoodQuery(query);
  return and(
    or(...terms.map((term) => and(...term.split(" ").map((word) => or(like(foods.name, `%${word}%`), like(foods.brand, `%${word}%`)))))),
    isNull(foods.hiddenAt)
  );
}

async function recordCompletedSearch(userId: string, query: string, localCount: number, resultCount: number) {
  const normalizedQuery = normalizeFoodQuery(query);
  if (normalizedQuery.length < 2) return;
  const now = new Date().toISOString();
  await db.insert(foodSearchStats).values({
    id: randomUUID(), userId, normalizedQuery, searchCount: 1,
    localMissCount: localCount === 0 ? 1 : 0, lastResultCount: resultCount, lastSearchedAt: now,
  }).onConflictDoUpdate({
    target: [foodSearchStats.userId, foodSearchStats.normalizedQuery],
    set: {
      searchCount: sql`${foodSearchStats.searchCount} + 1`,
      localMissCount: sql`${foodSearchStats.localMissCount} + ${localCount === 0 ? 1 : 0}`,
      lastResultCount: resultCount,
      lastSearchedAt: now,
    },
  });
}

export function registerFoodRoutes(app: FastifyInstance) {
  app.get("/api/foods", async (req) => {
    const { q, limit, source } = req.query as { q?: string; limit?: string; source?: string };
    const take = Math.min(Number(limit) || 20, 50);
    if (!q || q.trim() === "") {
      // `source` scopes the no-query "just list them" path — used by the Add
      // Food sheet's Library tab to browse custom foods on their own,
      // separate from recipe-materialized or OpenFoodFacts-cached rows.
      if (source) return db.select().from(foods).where(and(eq(foods.source, source), isNull(foods.hiddenAt))).orderBy(desc(foods.createdAt)).limit(take);
      return db.select().from(foods).where(isNull(foods.hiddenAt)).orderBy(desc(foods.createdAt)).limit(take);
    }
    const trimmed = q.trim();
    if (normalizeFoodQuery(trimmed).length < 2) return [];
    const normalizedQuery = normalizeFoodQuery(trimmed);
    // Over-fetch beyond `take` so there's a real pool of local matches to
    // re-rank below before slicing down to size — a plain `.limit(take)` here
    // would have already thrown away anything past the DB's own (arbitrary,
    // no ORDER BY) row order before "previously logged" got a say in it.
    // hiddenAt excludes anything "deleted" (kept alive only for history —
    // see the DELETE handler below) or an ai_estimate Describe row, neither
    // of which should ever resurface as a pickable search result.
    // The visible library is only a few thousand rows, so keep every match
    // until after relevance scoring. Limiting before sorting can silently
    // discard the exact match on broad terms such as "milk".
    const localCandidates = await db.select().from(foods).where(localFoodCondition(trimmed));
    const [learned] = await db.select({ foodId: foodSearchStats.selectedFoodId }).from(foodSearchStats)
      .where(and(eq(foodSearchStats.userId, req.userId!), eq(foodSearchStats.normalizedQuery, normalizedQuery)))
      .limit(1);
    const learnedIds = new Set<string>();
    if (learned?.foodId && !localCandidates.some((food) => food.id === learned.foodId)) {
      const [learnedFood] = await db.select().from(foods).where(and(eq(foods.id, learned.foodId), isNull(foods.hiddenAt)));
      if (learnedFood) localCandidates.push(learnedFood);
    }
    if (learned?.foodId) learnedIds.add(learned.foodId);

    // Foods someone's actually logged before are what a search should surface
    // first — e.g. "peanut butter" should rank a plain local Peanut Butter
    // you log every week ahead of an OpenFoodFacts fallback match in another
    // language you've never touched (source of the "Pâte d'arachide before
    // Peanut butter" report this was written for). `foods` has no logged-count
    // of its own, so this is a second query against `logs` rather than a
    // stored/denormalized column — trivial at personal-diary scale, same
    // trade-off other routes in this app already make (see logs/recent-days).
    const candidateIds = new Set(localCandidates.map((f) => f.id));
    const usage = new Map<string, { count: number; lastLoggedAt: string }>();
    if (candidateIds.size > 0) {
      // Read this user's small history once and filter it in JS. Building an
      // IN (...) statement from every broad local candidate (827 matches for
      // the first letter of "Honey") overloaded better-sqlite3's native
      // binding and terminated the process before the finished word could be
      // searched. Personal log history is much smaller than the food library,
      // making this both safer and cheaper for the one/two-letter edge case.
      const loggedRows = await db.select({ foodId: logs.foodId, loggedAt: logs.loggedAt }).from(logs)
        .where(eq(logs.userId, req.userId!));
      for (const row of loggedRows) {
        if (!candidateIds.has(row.foodId)) continue;
        const current = usage.get(row.foodId);
        usage.set(row.foodId, { count: (current?.count ?? 0) + 1, lastLoggedAt: current && current.lastLoggedAt > row.loggedAt ? current.lastLoggedAt : row.loggedAt });
      }
    }
    // Local matches had no relevance ranking at all until this — just
    // "logged before" as the only sort key, so an exact match with no log
    // history (e.g. a just-seeded AFCD "Honey") could rank behind eight
    // longer names that merely *contain* the word ("Porridge, rolled oats
    // mixed with sugar or honey...") purely because of arbitrary row order.
    // Name relevance now comes first — exact match, then starts-with, then
    // a whole-word match, then plain substring (the previous, only,
    // tier) — with "logged before" breaking ties *within* a relevance tier
    // only, not overriding it: a name match this strong is a much stronger
    // intent signal than log history.
    const local = localCandidates
      .sort((a, b) => {
        const aRelevance = Math.max(foodTextRelevance(a.name, a.brand, trimmed), learnedIds.has(a.id) ? 35 : 0);
        const bRelevance = Math.max(foodTextRelevance(b.name, b.brand, trimmed), learnedIds.has(b.id) ? 35 : 0);
        const relevanceDelta = bRelevance - aRelevance;
        if (relevanceDelta) return relevanceDelta;
        const aUsage = usage.get(a.id);
        const bUsage = usage.get(b.id);
        return (bUsage?.count ?? 0) - (aUsage?.count ?? 0)
          || (bUsage?.lastLoggedAt ?? "").localeCompare(aUsage?.lastLoggedAt ?? "")
          || a.name.localeCompare(b.name);
      })
      .slice(0, take);

    // Remote OFF results deliberately live on /api/foods/remote now. Returning
    // this SQLite result immediately lets the frontend paint known foods while
    // that slower, separately-debounced request continues in the background.
    return local;
  });

  app.get("/api/foods/remote", async (req) => {
    const { q, limit } = req.query as { q?: string; limit?: string };
    const trimmed = q?.trim() ?? "";
    if (!trimmed || normalizeFoodQuery(trimmed).length < 2) return [];
    const take = Math.min(Number(limit) || 20, 50);
    try {
      const offResults = await searchOffProducts(trimmed, take);
      // An absent energy field is unknown, not zero. Keep genuine explicit
      // zero-energy products, but don't show an incomplete OFF result as a
      // calorie-free food in search.
      const mapped = offResults
        .filter((r) => offCaloriesPer100g(r.product) !== null)
        .map((r) => ({
          id: `off:${r.code}`,
          createdAt: new Date().toISOString(),
          ...mapOffProduct(r.code, r.product),
        }));
      const [{ count: localCount }] = await db.select({ count: sql<number>`count(*)` }).from(foods).where(localFoodCondition(trimmed));
      await recordCompletedSearch(req.userId!, trimmed, Number(localCount), mapped.length);
      return mapped;
    } catch (err) {
      req.log.error(err);
      return [];
    }
  });

  app.post("/api/foods/search-selection", async (req, reply) => {
    const parsed = z.object({ query: z.string().trim().min(2).max(120), foodId: z.string().uuid(), source: z.string().max(40) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const normalizedQuery = normalizeFoodQuery(parsed.data.query);
    if (normalizedQuery.length < 2) {
      reply.code(204);
      return null;
    }
    const [selectedFood] = await db.select({ id: foods.id }).from(foods)
      .where(and(eq(foods.id, parsed.data.foodId), isNull(foods.hiddenAt)));
    if (!selectedFood) return reply.code(400).send({ error: "unknown foodId" });
    const now = new Date().toISOString();
    const remote = parsed.data.source === "openfoodfacts" ? 1 : 0;
    await db.insert(foodSearchStats).values({
      id: randomUUID(), userId: req.userId!, normalizedQuery, selectionCount: 1,
      remoteSelectionCount: remote, selectedFoodId: selectedFood.id, lastSearchedAt: now,
    }).onConflictDoUpdate({
      target: [foodSearchStats.userId, foodSearchStats.normalizedQuery],
      set: {
        selectionCount: sql`${foodSearchStats.selectionCount} + 1`,
        remoteSelectionCount: sql`${foodSearchStats.remoteSelectionCount} + ${remote}`,
        selectedFoodId: selectedFood.id,
        lastSearchedAt: now,
      },
    });
    reply.code(204);
    return null;
  });

  app.get("/api/foods/search-gaps", async (req) => db.select().from(foodSearchStats)
    .where(eq(foodSearchStats.userId, req.userId!))
    .orderBy(desc(foodSearchStats.localMissCount), desc(foodSearchStats.remoteSelectionCount), desc(foodSearchStats.lastSearchedAt))
    .limit(100));

  // Cache-first: a barcode already in our own database (whether from a previous
  // OFF lookup or a manually created custom food) always wins over a fresh
  // OpenFoodFacts call, both for speed and because a user's own correction to a
  // product's data should stick.
  app.get("/api/foods/barcode/:barcode", async (req, reply) => {
    const { barcode } = req.params as { barcode: string };

    const [cached] = await db.select().from(foods).where(eq(foods.barcode, barcode));
    if (cached) return cached;

    let product;
    try {
      product = await fetchOffProduct(barcode);
    } catch (err) {
      req.log.error(err);
      reply.code(502);
      return { error: "OpenFoodFacts lookup failed" };
    }
    if (!product) {
      reply.code(404);
      return { error: "No product found for this barcode" };
    }

    const mapped = mapOffProduct(barcode, product);
    const id = randomUUID();
    const now = new Date().toISOString();
    await db.insert(foods).values({ id, createdAt: now, ...mapped });
    const [food] = await db.select().from(foods).where(eq(foods.id, id));
    reply.code(201);
    return food;
  });

  // Vision-based nutrition-label OCR — a photo in, a partial CreateFoodInput
  // out, always via the create-food form (never auto-saved) so a misread
  // stays a one-field edit rather than a silently wrong food in the shared
  // library. Returns 503 rather than a raw SDK error when no API key is
  // configured for the selected provider, since that's the most likely
  // reason it is unavailable.
  app.post("/api/foods/scan-label", async (req, reply) => {
    if (!(await aiTaskConfigured(req.userId!, "labelScan"))) {
      reply.code(503);
      return { error: "Label scanning isn't configured on this server yet" };
    }

    const data = await req.file();
    if (!data) return reply.code(400).send({ error: "No file uploaded" });

    const raw = await data.toBuffer();
    let jpeg: Buffer;
    try {
      jpeg = await toBoundedJpeg(raw, { maxDimension: LABEL_MAX_DIMENSION, quality: LABEL_JPEG_QUALITY });
    } catch (err) {
      req.log.error(err);
      reply.code(400);
      return { error: "Couldn't process that image" };
    }

    try {
      const result = await scanNutritionLabel(req.userId!, jpeg, "image/jpeg");
      return result;
    } catch (err) {
      req.log.error(err);
      reply.code(502);
      return { error: "Couldn't read a nutrition label from that photo — try a clearer, closer shot" };
    }
  });

  // "Describe what you ate" → a list of already-persisted foods (existing
  // library matches reused as-is, unmatched items created fresh as
  // `source: 'ai_estimate'`) ready to stage onto the plate. See
  // engine/describeMeal.ts for the matching/creation logic. Always multipart
  // now (not a JSON body) since a photo is an optional third input alongside
  // the original typed text — `req.parts()` rather than `req.file()` because
  // a text-only submission still arrives as multipart from the frontend but
  // has no file part at all, which `req.file()` isn't built to shrug off.
  // The photo itself is never persisted (matches the typed-text path, which
  // was never saved anywhere either) — it only exists long enough to be
  // described, then discarded once describeMeal() returns.
  app.post("/api/foods/describe-meal", async (req, reply) => {
    if (!(await aiTaskConfigured(req.userId!, "mealDescription"))) {
      reply.code(503);
      return { error: "Meal description isn't configured on this server yet" };
    }

    let text: string | null = null;
    let photoRaw: Buffer | null = null;
    for await (const part of req.parts()) {
      if (part.type === "file" && part.fieldname === "photo") {
        photoRaw = await part.toBuffer();
      } else if (part.type === "field" && part.fieldname === "text") {
        text = String(part.value);
      }
    }

    const trimmedText = text?.trim() || null;
    if (trimmedText && trimmedText.length > 500) {
      return reply.code(400).send({ error: "Keep the description under 500 characters" });
    }
    if (!trimmedText && !photoRaw) {
      return reply.code(400).send({ error: "Describe your meal or attach a photo" });
    }

    let photo: { buffer: Buffer; mediaType: "image/jpeg" } | undefined;
    if (photoRaw) {
      try {
        const jpeg = await toBoundedJpeg(photoRaw, { maxDimension: PLATE_PHOTO_MAX_DIMENSION, quality: PLATE_PHOTO_JPEG_QUALITY });
        photo = { buffer: jpeg, mediaType: "image/jpeg" };
      } catch (err) {
        req.log.error(err);
        return reply.code(400).send({ error: "Couldn't process that photo" });
      }
    }

    try {
      return await describeMeal(req.userId!, trimmedText, photo);
    } catch (err) {
      req.log.error(err);
      reply.code(502);
      return { error: err instanceof Error ? err.message : "Couldn't make sense of that meal" };
    }
  });

  app.get("/api/foods/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [food] = await db.select().from(foods).where(eq(foods.id, id));
    if (!food) return reply.code(404).send({ error: "not found" });
    return food;
  });

  // Backs FoodDetailScreen's quantity prefill for a *new* log of a food
  // that's been logged before — separate from `editing`'s own
  // initialQuantityGrams (that one seeds from the specific entry being
  // edited, already known synchronously; this seeds from history instead).
  // Ordered by loggedAt, not `date` — loggedAt is a real per-entry
  // timestamp (see CLAUDE.md's note on the fake-UTC-but-actually-local
  // format), so this is "most recently logged", not "logged on the latest
  // date" (which would tiebreak arbitrarily among same-day entries).
  app.get("/api/foods/:id/last-quantity", async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .select({ quantityGrams: logs.quantityGrams, unitType: logs.unitType, unitMeasureName: logs.unitMeasureName })
      .from(logs)
      .where(and(eq(logs.foodId, id), eq(logs.userId, req.userId!)))
      .orderBy(desc(logs.loggedAt))
      .limit(1);
    return {
      quantityGrams: row?.quantityGrams ?? null,
      unitType: row?.unitType ?? null,
      unitMeasureName: row?.unitMeasureName ?? null,
    };
  });

  app.post("/api/foods", async (req, reply) => {
    const parsed = foodInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    // A custom food entered for a barcode that's already known (e.g. OFF had no
    // match and the user filled it in by hand) should reuse that row rather than
    // create a duplicate the next person scans into.
    if (parsed.data.barcode) {
      const [existing] = await db.select().from(foods).where(eq(foods.barcode, parsed.data.barcode));
      if (existing) return existing;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const { micros, measures, ...rest } = parsed.data;
    await db.insert(foods).values({
      id,
      source: "custom",
      createdAt: now,
      ...rest,
      microsJson: microsJsonFromInput(micros),
      measuresJson: measuresJsonFromInput(measures),
    });
    const [food] = await db.select().from(foods).where(eq(foods.id, id));
    reply.code(201);
    return food;
  });

  app.patch("/api/foods/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = foodInput.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { micros, measures, ...rest } = parsed.data;
    const microsJson = microsJsonFromInput(micros);
    const measuresJson = measuresJsonFromInput(measures);
    await db
      .update(foods)
      .set({ ...rest, ...(microsJson === undefined ? {} : { microsJson }), ...(measuresJson === undefined ? {} : { measuresJson }) })
      .where(eq(foods.id, id));
    const [food] = await db.select().from(foods).where(eq(foods.id, id));
    if (!food) return reply.code(404).send({ error: "not found" });
    return food;
  });

  // "Delete" always succeeds from the user's point of view. If nothing
  // references this food it's actually removed; if a log entry (or a
  // recipe's ingredient list) still points at it, hard-deleting would break
  // that history — nutrition is always computed live from this row, never
  // snapshotted onto the log — so it's hidden instead: gone from Library/
  // search/Favorites/Describe-matching, but still resolvable by id, so
  // existing log entries and copy-day both keep working exactly as before.
  app.delete("/api/foods/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await db.delete(foods).where(eq(foods.id, id));
    } catch (err) {
      if (err instanceof Error && err.message.includes("FOREIGN KEY constraint failed")) {
        await db.update(foods).set({ hiddenAt: new Date().toISOString() }).where(eq(foods.id, id));
        reply.code(204);
        return null;
      }
      throw err;
    }
    reply.code(204);
    return null;
  });
}
