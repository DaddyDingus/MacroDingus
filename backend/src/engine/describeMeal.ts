import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { foods, logs } from "../db/schema.js";
import { getAnthropicClient } from "./anthropicClient.js";

export interface DescribedItem {
  // The real, persisted foods row — either an existing one the model matched
  // by name, or a brand-new `source: 'ai_estimate'` row created on the spot.
  // Either way it already has a real id by the time this returns, so the
  // caller can stage it straight onto the plate exactly like a search result.
  food: typeof foods.$inferSelect;
  quantityGrams: number;
  servingDescription: string | null;
}

interface RawDescribedItem {
  matchedFoodId: string | null;
  name: string;
  quantityGrams: number;
  servingDescription: string | null;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number | null;
  sugarPer100g: number | null;
  saturatedFatPer100g: number | null;
  sodiumMgPer100g: number | null;
}

// Every item always carries the model's own per-100g estimate, even when it
// also sets matchedFoodId — that estimate is what a match falls back to if
// the id turns out to be hallucinated or stale (see the id-validation step
// in describeMeal below), so there's never a "matched but nothing to fall
// back on" gap. Hand-written JSON Schema for the same reason as
// labelScan.ts: the SDK's zodOutputFormat helper wants zod's `zod/v4`
// subpath, not the classic `zod` v3 namespace every route already uses.
const ITEM_SCHEMA = {
  type: "object",
  properties: {
    matchedFoodId: { type: ["string", "null"] },
    name: { type: "string" },
    quantityGrams: { type: "number" },
    servingDescription: { type: ["string", "null"] },
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
    "matchedFoodId", "name", "quantityGrams", "servingDescription",
    "caloriesPer100g", "proteinPer100g", "carbsPer100g", "fatPer100g",
    "fiberPer100g", "sugarPer100g", "saturatedFatPer100g", "sodiumMgPer100g",
  ],
  additionalProperties: false,
};

const DESCRIBE_MEAL_JSON_SCHEMA = {
  type: "object",
  properties: { items: { type: "array", items: ITEM_SCHEMA } },
  required: ["items"],
  additionalProperties: false,
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Drops any item missing a core field it can't reasonably default (name,
// quantity, or one of the four required macros) rather than passing a
// half-formed row through to the insert below — better to silently return
// fewer items than to create a garbage food.
function coerceItems(raw: unknown): RawDescribedItem[] {
  const items = raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).items)
    ? ((raw as Record<string, unknown>).items as unknown[])
    : [];
  const result: RawDescribedItem[] = [];
  for (const entry of items) {
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
      servingDescription: typeof o.servingDescription === "string" ? o.servingDescription : null,
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

// Candidates the model is allowed to match against: every custom food and
// recipe (a household builds a small, deliberate set of these) plus anything
// ever actually logged (covers previously-scanned barcodes/OFF matches worth
// reusing) — deliberately excludes the rest of the `openfoodfacts` cache
// (foods merely looked up once via search, never eaten), which would just
// bloat the prompt with irrelevant candidates. Capped at 300 and newest
// first as a simple bound for a personal-scale library, not a real ranking.
// The hiddenAt filter is what actually keeps this from ever re-matching a
// previous Describe call's own AI guess: every `ai_estimate` row is hidden
// the moment it's created (see the insert below), so a repeat description
// of "banana" always gets a fresh estimate rather than quietly reusing last
// time's — AI-created foods are meant to live only on the log entries that
// used them, never become a reusable library entry — and it excludes
// anything the user has since "deleted" (see foods route's DELETE) too.
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

// `text` and `hasPhoto` are never both false by the time this runs (the
// route requires at least one) — the three live combinations each get their
// own framing rather than one generic sentence, since "use both together"
// only makes sense to say when both are actually present.
function buildPrompt(
  text: string | null,
  hasPhoto: boolean,
  candidates: { id: string; name: string; brand: string | null }[]
): string {
  const candidateLines = candidates.map((c) => `${c.id} :: ${c.name}${c.brand ? ` (${c.brand})` : ""}`).join("\n");
  const task =
    hasPhoto && text
      ? `You're given a photo of a plate or meal, plus the user's own note: "${text}". Use both together — the photo for what's actually there and roughly how much, the note for anything the photo can't show (a dressing already mixed in, "no sugar", how something was cooked) or to correct what the photo might suggest.`
      : hasPhoto
      ? `You're given a photo of a plate or meal. Identify each distinct food or drink visible and estimate the amount eaten from its apparent portion size.`
      : `The user just described what they ate or drank: "${text}". Break the description into one entry per distinct food or drink actually consumed, with your best real-world estimate of the amount eaten in grams.`;
  return `${task} Break it into one entry per distinct food or drink.

For each item, first check whether it's essentially the same food as one of these existing library entries (id :: name):
${candidateLines || "(no existing foods yet)"}

If a library entry is clearly the same food — not just the same category; "chicken breast" already in the library isn't a match for a generic "chicken" mention unless that's really what was meant — set matchedFoodId to that entry's id. Otherwise set matchedFoodId to null.

Regardless of whether you set matchedFoodId, always fill in your own best per-100-gram nutrition estimate too (name, caloriesPer100g, proteinPer100g, carbsPer100g, fatPer100g, and fiberPer100g/sugarPer100g/saturatedFatPer100g/sodiumMgPer100g when you can reasonably estimate them, else null for just those four) — this is the fallback used if the matched entry turns out unavailable, so never leave it blank just because you set a match.

quantityGrams is your best estimate of the actual amount eaten (from the photo's apparent portion size and/or the description), not a generic single-serving default. servingDescription is a short human-readable gloss of that estimate, e.g. "about 1 medium bowl" or "2 slices".

If nothing edible is identifiable, return an empty items array rather than inventing something.`;
}

export async function describeMeal(
  text: string | null,
  photo?: { buffer: Buffer; mediaType: "image/jpeg" }
): Promise<DescribedItem[]> {
  const candidates = await fetchCandidateFoods();
  const candidateIds = new Set(candidates.map((c) => c.id));

  const prompt = buildPrompt(text, photo != null, candidates);
  const content: Array<
    | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }
    | { type: "text"; text: string }
  > = [];
  if (photo) content.push({ type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.buffer.toString("base64") } });
  content.push({ type: "text", text: prompt });

  const response = await getAnthropicClient().messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema: DESCRIBE_MEAL_JSON_SCHEMA } },
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("Couldn't make sense of that meal");

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new Error("Couldn't make sense of that meal");
  }

  const rawItems = coerceItems(parsed);
  if (rawItems.length === 0) throw new Error("Couldn't identify any foods — try a clearer photo or being more specific");

  // Only trust a matchedFoodId that was actually one of the candidates sent
  // (defends against a hallucinated or stale id) — everything else falls
  // back to the model's own estimate, which every item carries regardless.
  const validMatchedIds = [...new Set(rawItems.map((i) => i.matchedFoodId).filter((id): id is string => id != null && candidateIds.has(id)))];
  const matchedRows = validMatchedIds.length > 0 ? await db.select().from(foods).where(inArray(foods.id, validMatchedIds)) : [];
  const matchedById = new Map(matchedRows.map((f) => [f.id, f]));

  const results: DescribedItem[] = [];
  const now = new Date().toISOString();
  for (const item of rawItems) {
    const matched = item.matchedFoodId ? matchedById.get(item.matchedFoodId) : undefined;
    if (matched) {
      results.push({ food: matched, quantityGrams: item.quantityGrams, servingDescription: item.servingDescription });
      continue;
    }

    const id = randomUUID();
    await db.insert(foods).values({
      id,
      name: item.name,
      source: "ai_estimate",
      // Hidden from the moment it's created — see fetchCandidateFoods above
      // and every other hiddenAt-filtered query — so it's never offered as
      // a pick target anywhere, only ever reachable via the log entry(ies)
      // this call stages it onto.
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
    results.push({ food: created, quantityGrams: item.quantityGrams, servingDescription: item.servingDescription });
  }

  return results;
}
