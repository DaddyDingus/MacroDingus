import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, like, desc, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { foods, logs } from "../db/schema.js";
import { fetchOffProduct, mapOffProduct, searchOffProducts } from "../engine/openfoodfacts.js";
import { scanNutritionLabel } from "../engine/labelScan.js";
import { describeMeal } from "../engine/describeMeal.js";
import { toBoundedJpeg } from "../engine/imagePrep.js";

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
    // Over-fetch beyond `take` so there's a real pool of local matches to
    // re-rank below before slicing down to size — a plain `.limit(take)` here
    // would have already thrown away anything past the DB's own (arbitrary,
    // no ORDER BY) row order before "previously logged" got a say in it.
    // hiddenAt excludes anything "deleted" (kept alive only for history —
    // see the DELETE handler below) or an ai_estimate Describe row, neither
    // of which should ever resurface as a pickable search result.
    const localCandidates = await db.select().from(foods).where(and(like(foods.name, `%${trimmed}%`), isNull(foods.hiddenAt))).limit(take * 3);

    // Foods someone's actually logged before are what a search should surface
    // first — e.g. "peanut butter" should rank a plain local Peanut Butter
    // you log every week ahead of an OpenFoodFacts fallback match in another
    // language you've never touched (source of the "Pâte d'arachide before
    // Peanut butter" report this was written for). `foods` has no logged-count
    // of its own, so this is a second query against `logs` rather than a
    // stored/denormalized column — trivial at personal-diary scale, same
    // trade-off other routes in this app already make (see logs/recent-days).
    const candidateIds = localCandidates.map((f) => f.id);
    const loggedIds = new Set<string>();
    if (candidateIds.length > 0) {
      const loggedRows = await db.selectDistinct({ foodId: logs.foodId }).from(logs).where(inArray(logs.foodId, candidateIds));
      for (const row of loggedRows) loggedIds.add(row.foodId);
    }
    // Array.prototype.sort is stable (guaranteed since ES2019), so this is a
    // straight two-bucket partition — previously-logged foods first, in
    // whatever relative order they already had, then everything else the
    // same way — not a full re-sort that could otherwise reshuffle matches
    // within either bucket.
    const local = localCandidates
      .sort((a, b) => Number(loggedIds.has(b.id)) - Number(loggedIds.has(a.id)))
      .slice(0, take);

    // This instance's `foods` table only ever gets rows from a barcode scan, a
    // custom entry, or a materialized recipe — there's no bulk generic food
    // database seeded anywhere, so a plain-language term like "oats" can come
    // back empty from local matches alone. Fold in OpenFoodFacts name-search
    // results for whatever local didn't cover — always after every local
    // match regardless of logged status, since these are unfamiliar-by
    // definition (never logged, not even cached locally yet). These are
    // synthetic (id `off:<barcode>`, not a real row yet) — the frontend
    // resolves one into an actual cached food via the existing barcode
    // lookup only once the user picks it, same cache-on-select behavior the
    // barcode scanner already has.
    if (local.length < take) {
      try {
        const localBarcodes = new Set(local.map((f) => f.barcode).filter((b): b is string => !!b));
        const offResults = await searchOffProducts(trimmed, take - local.length);
        const remote = offResults
          .filter((r) => !localBarcodes.has(r.code))
          .map((r) => ({ id: `off:${r.code}`, createdAt: new Date().toISOString(), ...mapOffProduct(r.code, r.product) }));
        return [...local, ...remote];
      } catch (err) {
        req.log.error(err);
        return local;
      }
    }

    return local;
  });

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
  // configured, since this is the one feature in the app with an external
  // dependency and that's the most likely reason it's unavailable.
  app.post("/api/foods/scan-label", async (req, reply) => {
    if (!process.env.ANTHROPIC_API_KEY) {
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
      const result = await scanNutritionLabel(jpeg, "image/jpeg");
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
    if (!process.env.ANTHROPIC_API_KEY) {
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
      return await describeMeal(trimmedText, photo);
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
    const { micros, ...rest } = parsed.data;
    await db.insert(foods).values({
      id,
      source: "custom",
      createdAt: now,
      ...rest,
      microsJson: microsJsonFromInput(micros),
    });
    const [food] = await db.select().from(foods).where(eq(foods.id, id));
    reply.code(201);
    return food;
  });

  app.patch("/api/foods/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = foodInput.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { micros, ...rest } = parsed.data;
    const microsJson = microsJsonFromInput(micros);
    await db
      .update(foods)
      .set(microsJson === undefined ? rest : { ...rest, microsJson })
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
