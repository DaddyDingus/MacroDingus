import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { foods, logs } from "../db/schema.js";
import { getAnthropicClient } from "./anthropicClient.js";
import { assertPublicUrl, BlockedUrlError } from "./urlGuard.js";

export interface ImportedIngredient {
  // Always a real, persisted foods row by the time this returns — matches
  // describeMeal.ts's own DescribedItem contract (see that file), just
  // without servingDescription (a recipe ingredient doesn't need one).
  food: typeof foods.$inferSelect;
  quantityGrams: number;
}

export interface ImportedRecipe {
  name: string;
  servings: number;
  // Only set when the page itself states a finished/cooked weight — RecipeForm
  // already treats a null totalWeightGrams as "default to the ingredient
  // gram sum" (see its own weightOverride logic), so this only needs to
  // carry a real value when the source page actually has one.
  totalWeightGrams: number | null;
  ingredients: ImportedIngredient[];
}

interface RawIngredient {
  matchedFoodId: string | null;
  name: string;
  quantityGrams: number;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number | null;
  sugarPer100g: number | null;
  saturatedFatPer100g: number | null;
  sodiumMgPer100g: number | null;
}

// Same hand-written-JSON-Schema reasoning as describeMeal.ts/labelScan.ts —
// the SDK's zodOutputFormat helper needs zod's `/v4` subpath, a different
// namespace from the `zod` v3 every route's request validation already uses.
const INGREDIENT_SCHEMA = {
  type: "object",
  properties: {
    matchedFoodId: { type: ["string", "null"] },
    name: { type: "string" },
    quantityGrams: { type: "number" },
    caloriesPer100g: { type: "number" },
    proteinPer100g: { type: "number" },
    carbsPer100g: { type: "number" },
    fatPer100g: { type: "number" },
    fiberPer100g: { type: ["number", "null"] },
    sugarPer100g: { type: ["number", "null"] },
    saturatedFatPer100g: { type: ["number", "null"] },
    sodiumMgPer100g: { type: ["number", "null"] },
  },
  required: [
    "matchedFoodId", "name", "quantityGrams",
    "caloriesPer100g", "proteinPer100g", "carbsPer100g", "fatPer100g",
    "fiberPer100g", "sugarPer100g", "saturatedFatPer100g", "sodiumMgPer100g",
  ],
  additionalProperties: false,
};

const RECIPE_JSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    servings: { type: "number" },
    totalWeightGrams: { type: ["number", "null"] },
    ingredients: { type: "array", items: INGREDIENT_SCHEMA },
  },
  required: ["name", "servings", "totalWeightGrams", "ingredients"],
  additionalProperties: false,
};

const FETCH_TIMEOUT_MS = 15000;
// Recipe pages are mostly boilerplate (nav, ads, comments, "jump to recipe"
// banners, SEO copy) around a small real recipe — 40k characters of stripped
// text is generous enough to comfortably still contain it after stripping,
// without letting a pathological page balloon the prompt.
const MAX_TEXT_CHARS = 40000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Reading an unbounded body into memory is its own denial-of-service: a
// pathological URL can stream gigabytes into a container with a 256 MB cap.
// Only enough bytes to comfortably contain a recipe are ever buffered.
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

async function readBounded(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8");
  const chunks: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
      if (total >= MAX_BODY_BYTES) break; // truncate rather than fail — a recipe is near the top
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return chunks.join("");
}

async function fetchPageText(url: string): Promise<string> {
  // Redirects are followed by hand so that EVERY hop is re-validated. With
  // `redirect: "follow"` a public URL can 302 straight to an internal one and
  // only the first host would ever have been checked.
  let current = await assertPublicUrl(url);
  let res: Response | null = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      res = await fetch(current.toString(), {
        signal: controller.signal,
        redirect: "manual",
        // A bare Node fetch UA gets blocked or served a stripped-down page by
        // several popular recipe sites — a normal browser UA avoids that.
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch {
      throw new BlockedUrlError();
    } finally {
      clearTimeout(timeout);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new BlockedUrlError();
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }
    break;
  }

  // Every failure below collapses to the same message as a blocked URL.
  // Distinguishing "not found" from "forbidden" from "unreachable" is what
  // would let this endpoint map the network it runs on.
  if (!res || !res.ok) throw new BlockedUrlError();

  const html = await readBounded(res);
  const text = stripHtml(html).slice(0, MAX_TEXT_CHARS);
  if (text.length < 200) throw new Error("Couldn't find any real content at that link");
  return text;
}

// Identical candidate set/reasoning to describeMeal.ts's own
// fetchCandidateFoods — kept as a separate copy rather than a shared import
// since the two features' output shapes (a flat log-ready list vs. a whole
// recipe) are different enough that forcing them through one helper would
// mean threading extra parameters through describeMeal's already-tuned path
// for this feature's sake alone.
async function fetchCandidateFoods() {
  const loggedRows = await db.selectDistinct({ foodId: logs.foodId }).from(logs);
  const loggedIds = loggedRows.map((r) => r.foodId);
  const conditions = [inArray(foods.source, ["custom", "recipe"])];
  if (loggedIds.length > 0) conditions.push(inArray(foods.id, loggedIds));
  return db
    .select({ id: foods.id, name: foods.name, brand: foods.brand })
    .from(foods)
    .where(and(or(...conditions), isNull(foods.hiddenAt)))
    .orderBy(desc(foods.createdAt))
    .limit(300);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function coerceIngredients(raw: unknown): RawIngredient[] {
  const arr = Array.isArray(raw) ? raw : [];
  const result: RawIngredient[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const name = typeof o.name === "string" && o.name.trim() !== "" ? o.name.trim() : null;
    const quantityGrams = num(o.quantityGrams);
    const caloriesPer100g = num(o.caloriesPer100g);
    const proteinPer100g = num(o.proteinPer100g);
    const carbsPer100g = num(o.carbsPer100g);
    const fatPer100g = num(o.fatPer100g);
    if (name == null || quantityGrams == null || caloriesPer100g == null || proteinPer100g == null || carbsPer100g == null || fatPer100g == null) {
      continue;
    }
    result.push({
      matchedFoodId: typeof o.matchedFoodId === "string" ? o.matchedFoodId : null,
      name,
      quantityGrams,
      caloriesPer100g,
      proteinPer100g,
      carbsPer100g,
      fatPer100g,
      fiberPer100g: num(o.fiberPer100g),
      sugarPer100g: num(o.sugarPer100g),
      saturatedFatPer100g: num(o.saturatedFatPer100g),
      sodiumMgPer100g: num(o.sodiumMgPer100g),
    });
  }
  return result;
}

function buildPrompt(pageText: string, candidates: { id: string; name: string; brand: string | null }[]): string {
  const candidateLines = candidates.map((c) => `${c.id} :: ${c.name}${c.brand ? ` (${c.brand})` : ""}`).join("\n");
  return `Here is the text content of a webpage that's expected to contain a cooking recipe:
"""
${pageText}
"""

Extract the recipe into structured data: its name, how many servings it makes, and its full ingredient list. Convert every ingredient's amount into grams using standard cooking conversions and your own best judgment (e.g. "1 medium onion" ≈ 150g, "1 cup all-purpose flour" ≈ 120g) — quantityGrams must always be a real gram amount, never left as a volume/count. Set totalWeightGrams only if the page itself states the dish's finished/cooked weight; otherwise null.

For each ingredient, first check whether it's essentially the same food as one of these existing library entries (id :: name):
${candidateLines || "(no existing foods yet)"}
If a library entry is clearly the same food — not just the same category — set matchedFoodId to that entry's id, otherwise null. Regardless of whether you set a match, always fill in your own best per-100-gram nutrition estimate too (name, caloriesPer100g, proteinPer100g, carbsPer100g, fatPer100g, and fiberPer100g/sugarPer100g/saturatedFatPer100g/sodiumMgPer100g when you can reasonably estimate them, else null for just those four) — this is the fallback used if the matched entry turns out unavailable.

If this page doesn't actually contain a recipe, return an empty ingredients array rather than inventing one.`;
}

export async function importRecipeFromUrl(userId: string, url: string): Promise<ImportedRecipe> {
  const pageText = await fetchPageText(url);
  const candidates = await fetchCandidateFoods();
  const candidateIds = new Set(candidates.map((c) => c.id));

  const response = await getAnthropicClient(userId).messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: buildPrompt(pageText, candidates) }],
    output_config: { format: { type: "json_schema", schema: RECIPE_JSON_SCHEMA } },
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("Couldn't make sense of that page");

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new Error("Couldn't make sense of that page");
  }

  const o = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const name = typeof o.name === "string" && o.name.trim() !== "" ? o.name.trim() : "Imported recipe";
  const servings = num(o.servings) && num(o.servings)! > 0 ? num(o.servings)! : 1;
  const totalWeightGrams = num(o.totalWeightGrams);
  const rawIngredients = coerceIngredients(o.ingredients);
  if (rawIngredients.length === 0) {
    throw new Error("Couldn't find a recipe on that page — try pasting the link to the recipe itself, not a category or index page");
  }

  // Only trust a matchedFoodId that was actually one of the candidates sent
  // — same defensive check as describeMeal.ts, against a hallucinated or
  // stale id.
  const validMatchedIds = [...new Set(rawIngredients.map((i) => i.matchedFoodId).filter((id): id is string => id != null && candidateIds.has(id)))];
  const matchedRows = validMatchedIds.length > 0 ? await db.select().from(foods).where(inArray(foods.id, validMatchedIds)) : [];
  const matchedById = new Map(matchedRows.map((f) => [f.id, f]));

  const ingredients: ImportedIngredient[] = [];
  const now = new Date().toISOString();
  for (const item of rawIngredients) {
    const matched = item.matchedFoodId ? matchedById.get(item.matchedFoodId) : undefined;
    if (matched) {
      ingredients.push({ food: matched, quantityGrams: item.quantityGrams });
      continue;
    }

    const id = randomUUID();
    await db.insert(foods).values({
      id,
      name: item.name,
      source: "ai_estimate",
      // Hidden from the moment it's created — same reasoning as
      // describeMeal.ts: meant to back only this recipe's own ingredient
      // list, never surface as a reusable Library entry on its own.
      hiddenAt: now,
      caloriesPer100g: item.caloriesPer100g,
      proteinPer100g: item.proteinPer100g,
      carbsPer100g: item.carbsPer100g,
      fatPer100g: item.fatPer100g,
      fiberPer100g: item.fiberPer100g,
      sugarPer100g: item.sugarPer100g,
      saturatedFatPer100g: item.saturatedFatPer100g,
      sodiumMgPer100g: item.sodiumMgPer100g,
      createdAt: now,
    });
    const [created] = await db.select().from(foods).where(eq(foods.id, id));
    ingredients.push({ food: created, quantityGrams: item.quantityGrams });
  }

  return { name, servings, totalWeightGrams, ingredients };
}
