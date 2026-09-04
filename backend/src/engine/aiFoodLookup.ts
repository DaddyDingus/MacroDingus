import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { foods } from "../db/schema.js";
import { generateAiText } from "./aiProvider.js";
import { normalizeFoodQuery } from "./foodSearch.js";

type FoodRow = typeof foods.$inferSelect;

interface Candidate {
  id: string;
  database: "AFCD" | "USDA FoodData Central";
  sourceFoodId: string;
  sourceFoodName: string;
  food: Omit<FoodRow, "id" | "source" | "createdAt" | "hiddenAt" | "provenanceJson">;
}

interface Resolution {
  selectedId: string | null;
  displayName: string | null;
  confidence: "high" | "medium" | "low";
  assumptions: string[];
  clarificationQuestion: string | null;
  clarificationOptions: string[];
}

export type AiFoodLookupResult =
  | { status: "clarification"; question: string; options: string[] }
  | {
      status: "resolved";
      food: FoodRow;
      quantityGrams: number;
      confidence: Resolution["confidence"];
      assumptions: string[];
      sourceDatabase: Candidate["database"];
      sourceFoodName: string;
    };

const RESOLUTION_SCHEMA = {
  type: "object",
  properties: {
    selectedId: { type: ["string", "null"] },
    displayName: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    assumptions: { type: "array", items: { type: "string" }, maxItems: 6 },
    clarificationQuestion: { type: ["string", "null"] },
    clarificationOptions: { type: "array", items: { type: "string" }, maxItems: 4 },
  },
  required: ["selectedId", "displayName", "confidence", "assumptions", "clarificationQuestion", "clarificationOptions"],
  additionalProperties: false,
};

// Quantity words and cooking apparatus describe the request, not the food's
// identity in a composition database. Preparation words are retained as a
// separate signal so smoked meat can prefer a cooked/roasted record without
// requiring AFCD to literally contain "pellet smoker" in its name.
const QUERY_NOISE = new Set([
  "a", "an", "of", "the", "per", "portion", "serving", "gram", "grams", "g",
  "pellet", "pellets", "smoker", "smoked", "smoking", "cooked", "cooking",
]);
const PREPARATION_WORDS = new Set(["smoked", "smoking", "cooked", "roasted", "grilled", "fried", "boiled", "casseroled", "raw"]);

function queryTokens(description: string): { identity: string[]; preparations: string[] } {
  const tokens = normalizeFoodQuery(description).split(" ").filter(Boolean);
  return {
    identity: [...new Set(tokens.filter((token) => !QUERY_NOISE.has(token) && !/^\d+(?:\.\d+)?(?:g|gram|grams)?$/.test(token)))],
    preparations: [...new Set(tokens.filter((token) => PREPARATION_WORDS.has(token)))],
  };
}

function quantityFromDescription(description: string): number {
  const match = description.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:g|grams?)\b/i);
  const value = match ? Number(match[1]) : 100;
  return Number.isFinite(value) && value > 0 && value <= 10_000 ? value : 100;
}

function localScore(name: string, identity: string[], preparations: string[]): number {
  const normalized = normalizeFoodQuery(name);
  const words = new Set(normalized.split(" "));
  const matchedIdentity = identity.filter((token) => words.has(token) || normalized.includes(token));
  if (identity.length > 1 && matchedIdentity.length < Math.min(2, identity.length)) return 0;
  if (matchedIdentity.length === 0) return 0;
  let score = matchedIdentity.length * 20 - (identity.length - matchedIdentity.length) * 8;
  if (preparations.some((word) => words.has(word))) score += 8;
  if (preparations.some((word) => word === "smoked" || word === "smoking" || word === "cooked")) {
    if (["roasted", "grilled", "casseroled", "cooked"].some((word) => words.has(word))) score += 6;
    if (words.has("raw")) score -= 12;
  }
  return score;
}

function candidateFromAfcd(food: FoodRow): Candidate {
  const { id, source: _source, createdAt: _createdAt, hiddenAt: _hiddenAt, provenanceJson: _provenanceJson, ...copy } = food;
  return { id: `afcd:${id}`, database: "AFCD", sourceFoodId: id, sourceFoodName: food.name, food: copy };
}

async function localCandidates(description: string): Promise<Candidate[]> {
  const { identity, preparations } = queryTokens(description);
  if (identity.length === 0) return [];
  const rows = await db.select().from(foods).where(andSource("afcd"));
  return rows
    .map((food) => ({ food, score: localScore(food.name, identity, preparations) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
    .slice(0, 36)
    .map((entry) => candidateFromAfcd(entry.food));
}

function andSource(source: string) {
  // Kept as a helper so every candidate source query consistently excludes
  // soft-deleted rows even though AFCD rows are not normally deletable.
  return and(eq(foods.source, source), isNull(foods.hiddenAt));
}

interface FdcNutrient { nutrientName?: string; unitName?: string; value?: number }
interface FdcFood { fdcId?: number; description?: string; dataType?: string; foodNutrients?: FdcNutrient[] }

function nutrientValue(food: FdcFood, names: RegExp): number | null {
  const row = food.foodNutrients?.find((nutrient) => names.test(nutrient.nutrientName ?? ""));
  return typeof row?.value === "number" && Number.isFinite(row.value) ? row.value : null;
}

function energyKcal(food: FdcFood): number | null {
  const rows = food.foodNutrients?.filter((nutrient) => /^Energy$/i.test(nutrient.nutrientName ?? "")) ?? [];
  const kcal = rows.find((nutrient) => nutrient.unitName?.toUpperCase() === "KCAL")?.value;
  if (typeof kcal === "number" && Number.isFinite(kcal)) return kcal;
  const kj = rows.find((nutrient) => nutrient.unitName?.toUpperCase() === "KJ")?.value;
  return typeof kj === "number" && Number.isFinite(kj) ? kj / 4.184 : null;
}

function nutrientGrams(food: FdcFood, names: RegExp): number | null {
  const row = food.foodNutrients?.find((nutrient) => names.test(nutrient.nutrientName ?? ""));
  if (typeof row?.value !== "number" || !Number.isFinite(row.value)) return null;
  const unit = row.unitName?.toUpperCase();
  if (unit === "G") return row.value;
  if (unit === "MG") return row.value / 1_000;
  if (unit === "UG" || unit === "µG") return row.value / 1_000_000;
  return null;
}

const USDA_MICROS: Array<[string, RegExp]> = [
  ["vitamin-a_100g", /^Vitamin A, RAE$/i], ["vitamin-c_100g", /^Vitamin C/i],
  ["vitamin-d_100g", /^Vitamin D \(D2 \+ D3\)$/i], ["vitamin-e_100g", /^Vitamin E/i],
  ["vitamin-k_100g", /^Vitamin K/i], ["vitamin-b1_100g", /^Thiamin$/i],
  ["vitamin-b2_100g", /^Riboflavin$/i], ["vitamin-pp_100g", /^Niacin$/i],
  ["vitamin-b6_100g", /^Vitamin B-6$/i], ["vitamin-b9_100g", /^Folate, total$/i],
  ["vitamin-b12_100g", /^Vitamin B-12$/i], ["calcium_100g", /^Calcium, Ca$/i],
  ["iron_100g", /^Iron, Fe$/i], ["potassium_100g", /^Potassium, K$/i],
  ["magnesium_100g", /^Magnesium, Mg$/i], ["zinc_100g", /^Zinc, Zn$/i],
  ["phosphorus_100g", /^Phosphorus, P$/i], ["copper_100g", /^Copper, Cu$/i],
  ["manganese_100g", /^Manganese, Mn$/i], ["selenium_100g", /^Selenium, Se$/i],
  ["cholesterol_100g", /^Cholesterol$/i],
];

function candidateFromUsda(food: FdcFood): Candidate | null {
  if (!food.fdcId || !food.description) return null;
  const calories = energyKcal(food);
  const protein = nutrientGrams(food, /^Protein$/i);
  const carbs = nutrientGrams(food, /^Carbohydrate, by difference$/i);
  const fat = nutrientGrams(food, /^Total lipid \(fat\)$/i);
  if (calories == null || protein == null || carbs == null || fat == null) return null;
  const micros = Object.fromEntries(USDA_MICROS.flatMap(([key, pattern]) => {
    const value = nutrientGrams(food, pattern);
    return value == null ? [] : [[key, value]];
  }));
  const nullable = (value: number | null) => value ?? null;
  return {
    id: `usda:${food.fdcId}`,
    database: "USDA FoodData Central",
    sourceFoodId: String(food.fdcId),
    sourceFoodName: food.description,
    food: {
      name: food.description,
      brand: null,
      barcode: null,
      servingSizeGrams: 100,
      servingName: "100 g",
      measuresJson: null,
      caloriesPer100g: calories,
      proteinPer100g: protein,
      carbsPer100g: carbs,
      fatPer100g: fat,
      fiberPer100g: nullable(nutrientGrams(food, /^Fiber, total dietary$/i)),
      sugarPer100g: nullable(nutrientGrams(food, /^Sugars, total/i)),
      saturatedFatPer100g: nullable(nutrientGrams(food, /^Fatty acids, total saturated$/i)),
      sodiumMgPer100g: nullable(nutrientValue(food, /^Sodium, Na$/i)),
      monounsaturatedFatPer100g: nullable(nutrientGrams(food, /^Fatty acids, total monounsaturated$/i)),
      polyunsaturatedFatPer100g: nullable(nutrientGrams(food, /^Fatty acids, total polyunsaturated$/i)),
      omega3Per100g: null,
      omega6Per100g: null,
      transFatPer100g: nullable(nutrientGrams(food, /^Fatty acids, total trans$/i)),
      microsJson: Object.keys(micros).length ? JSON.stringify(micros) : null,
      aminoAcidsJson: null,
      carbDetailJson: null,
      icon: null,
    },
  };
}

async function usdaCandidates(description: string): Promise<Candidate[]> {
  const { identity } = queryTokens(description);
  if (identity.length === 0) return [];
  const query = identity.join(" ");
  const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(process.env.USDA_FDC_API_KEY?.trim() || "DEMO_KEY")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, dataType: ["Foundation", "Survey (FNDDS)", "SR Legacy"], pageSize: 30 }),
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) throw new Error(`USDA FoodData Central returned ${response.status}`);
  const body = await response.json() as { foods?: FdcFood[] };
  return (body.foods ?? []).flatMap((food) => {
    const candidate = candidateFromUsda(food);
    return candidate ? [candidate] : [];
  });
}

function candidateSummary(candidate: Candidate): string {
  const food = candidate.food;
  return `${candidate.id} :: ${candidate.sourceFoodName} :: ${candidate.database} :: ${food.caloriesPer100g} kcal, ${food.proteinPer100g}g protein, ${food.carbsPer100g}g carbs, ${food.fatPer100g}g fat per 100g`;
}

function parseResolution(raw: string): Resolution {
  const parsed = JSON.parse(raw) as Partial<Resolution>;
  const confidence = ["high", "medium", "low"].includes(parsed.confidence ?? "") ? parsed.confidence as Resolution["confidence"] : "low";
  return {
    selectedId: typeof parsed.selectedId === "string" ? parsed.selectedId : null,
    displayName: typeof parsed.displayName === "string" ? parsed.displayName.trim() : null,
    confidence,
    assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.filter((value): value is string => typeof value === "string").slice(0, 6) : [],
    clarificationQuestion: typeof parsed.clarificationQuestion === "string" ? parsed.clarificationQuestion.trim() : null,
    clarificationOptions: Array.isArray(parsed.clarificationOptions) ? parsed.clarificationOptions.filter((value): value is string => typeof value === "string" && value.trim() !== "").slice(0, 4) : [],
  };
}

function validateCandidate(candidate: Candidate) {
  const f = candidate.food;
  const core = [f.caloriesPer100g, f.proteinPer100g, f.carbsPer100g, f.fatPer100g];
  if (core.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("The source returned invalid nutrition values");
  if (f.caloriesPer100g > 950 || [f.proteinPer100g, f.carbsPer100g, f.fatPer100g].some((value) => value > 100)) {
    throw new Error("The source returned nutrition outside a valid per-100-gram range");
  }
}

function safeDisplayName(value: string | null, fallback: string): string {
  const name = value?.replace(/[\r\n]+/g, " ").trim();
  return name && name.length <= 140 ? name : fallback;
}

async function resolveCandidate(userId: string, prompt: string): Promise<Resolution> {
  try {
    return parseResolution(await generateAiText(userId, "foodLookup", { prompt, maxTokens: 900, jsonSchema: RESOLUTION_SCHEMA }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/(high demand|overloaded|rate limit|\b429\b|\b503\b)/i.test(message)) throw error;
    // A single short retry absorbs the transient provider spike observed in
    // the real two-step lamb clarification flow. Longer retry policy remains
    // the configured cross-provider fallback's job.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return parseResolution(await generateAiText(userId, "foodLookup", { prompt, maxTokens: 900, jsonSchema: RESOLUTION_SCHEMA }));
  }
}

export async function lookupSourcedFood(userId: string, description: string, clarification?: string): Promise<AiFoodLookupResult> {
  const quantityGrams = quantityFromDescription(description);
  let candidates = await localCandidates(description);
  // AFCD is the Australian-first authority. USDA is queried only when local
  // lexical retrieval has no credible composition candidates, keeping the
  // common path faster and available even if the external service is down.
  if (candidates.length === 0) {
    try {
      candidates = await usdaCandidates(description);
    } catch {
      candidates = [];
    }
  }
  if (candidates.length === 0) throw new Error("Couldn't find an authoritative generic-food match");

  const clarifiedRequest = clarification?.trim() ? `${description}\nUser clarification: ${clarification.trim()}` : description;
  const prompt = `Resolve this user's generic food description to exactly one authoritative composition record.

Request: ${clarifiedRequest}

Candidates (all nutrition is per 100 g):
${candidates.map(candidateSummary).join("\n")}

Rules:
- Never invent nutrition or an id. selectedId must be one listed candidate id or null.
- Prefer the closest cooked state, cut, edible portion, and fat/trim state. Smoking without sauce is nutritionally closest to an appropriate cooked/roasted record; the smoker fuel itself adds no macros.
- If an omitted detail creates a materially different calorie result (especially lean/trimmed versus untrimmed, meat-only versus skin/fat, drained versus undrained, or sauce/glaze), return selectedId null and ask one short clarification question with 2-4 concise tap options.
- Do not ask about details that do not materially affect nutrition. If the user already clarified it, make the best match and disclose any remaining assumption.
- displayName should be concise and natural, preserve meaningful preparation from the request, and disclose trim state when relevant. Do not claim the cited record was smoked if it was merely the closest roasted proxy; phrase that as an assumption instead.
- confidence is about the match to the source record, not laboratory certainty for this individual serving.
- assumptions must be short, factual disclosures. Never manufacture a nutrient value.`;

  let resolution: Resolution;
  try {
    resolution = await resolveCandidate(userId, prompt);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Couldn't understand the food lookup result");
    throw error;
  }

  if (resolution.clarificationQuestion && resolution.clarificationOptions.length >= 2 && !clarification?.trim()) {
    return { status: "clarification", question: resolution.clarificationQuestion, options: resolution.clarificationOptions };
  }
  const candidate = candidates.find((entry) => entry.id === resolution.selectedId);
  if (!candidate) throw new Error("Couldn't confidently match that description to authoritative food data");
  validateCandidate(candidate);

  const displayName = safeDisplayName(resolution.displayName, candidate.sourceFoodName);
  const lookupKey = normalizeFoodQuery(`${description} ${clarification ?? ""}`);
  const reusable = await db.select().from(foods).where(andSource("ai_sourced")).orderBy(desc(foods.createdAt)).limit(200);
  const existing = reusable.find((food) => {
    try {
      const provenance = JSON.parse(food.provenanceJson ?? "{}") as { lookupKey?: string; sourceFoodId?: string };
      return provenance.lookupKey === lookupKey && provenance.sourceFoodId === candidate.sourceFoodId;
    } catch {
      return false;
    }
  });
  if (existing) {
    return { status: "resolved", food: existing, quantityGrams, confidence: resolution.confidence, assumptions: resolution.assumptions, sourceDatabase: candidate.database, sourceFoodName: candidate.sourceFoodName };
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await db.insert(foods).values({
    id,
    ...candidate.food,
    name: displayName,
    source: "ai_sourced",
    servingSizeGrams: 100,
    servingName: "100 g",
    provenanceJson: JSON.stringify({
      version: 1,
      lookupKey,
      lookupDescription: description,
      clarification: clarification?.trim() || null,
      database: candidate.database,
      sourceFoodId: candidate.sourceFoodId,
      sourceFoodName: candidate.sourceFoodName,
      sourceUrl: candidate.database === "AFCD"
        ? "https://www.foodstandards.gov.au/science-data/monitoringnutrients/afcd"
        : `https://fdc.nal.usda.gov/food-details/${candidate.sourceFoodId}/nutrients`,
      confidence: resolution.confidence,
      assumptions: resolution.assumptions,
      resolvedAt: createdAt,
    }),
    hiddenAt: null,
    createdAt,
  });
  const [created] = await db.select().from(foods).where(eq(foods.id, id));
  return { status: "resolved", food: created, quantityGrams, confidence: resolution.confidence, assumptions: resolution.assumptions, sourceDatabase: candidate.database, sourceFoodName: candidate.sourceFoodName };
}
