import { generateAiText } from "./aiProvider.js";

// Every nutrient the model returns is per-100g, not per-serving — it does the
// serving-size conversion itself (see the prompt below) so the result drops
// straight into CreateFoodInput/foodInput's own per-100g fields with no
// further math on this end. Nullable rather than optional: the model is
// explicitly told to return null for anything it can't read/determine,
// rather than guess, so a missing field is a real "unknown" signal to pass
// through to the frontend (which leaves those inputs blank) instead of a
// fabricated 0.
export interface LabelScanResult {
  name: string | null;
  brand: string | null;
  servingSizeGrams: number | null;
  servingName: string | null;
  caloriesPer100g: number | null;
  proteinPer100g: number | null;
  carbsPer100g: number | null;
  fatPer100g: number | null;
  fiberPer100g: number | null;
  sugarPer100g: number | null;
  saturatedFatPer100g: number | null;
  sodiumMgPer100g: number | null;
}

const STRING_FIELDS = new Set<keyof LabelScanResult>(["name", "brand", "servingName"]);
const LABEL_SCAN_FIELDS = Object.keys({
  name: 0, brand: 0, servingSizeGrams: 0, servingName: 0, caloriesPer100g: 0, proteinPer100g: 0,
  carbsPer100g: 0, fatPer100g: 0, fiberPer100g: 0, sugarPer100g: 0, saturatedFatPer100g: 0, sodiumMgPer100g: 0,
} satisfies Record<keyof LabelScanResult, 0>) as (keyof LabelScanResult)[];

// This app-specific JSON Schema travels with the gateway prompt; the plain
// type guard below still validates the normalized result before it is used.
const LABEL_SCAN_JSON_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    LABEL_SCAN_FIELDS.map((f) => [f, { type: [STRING_FIELDS.has(f) ? "string" : "number", "null"] }])
  ),
  required: LABEL_SCAN_FIELDS,
  additionalProperties: false,
};

// Coerces whatever the model returned into the expected shape rather than
// trusting the schema constraint blindly — a field of the wrong type becomes
// null (an honest "unknown") instead of either crashing this route or
// silently reaching the frontend as a malformed number/string.
function coerceLabelScanResult(raw: unknown): LabelScanResult {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const result = {} as Record<keyof LabelScanResult, string | number | null>;
  for (const field of LABEL_SCAN_FIELDS) {
    const value = obj[field];
    if (STRING_FIELDS.has(field)) result[field] = typeof value === "string" ? value : null;
    else result[field] = typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  return result as LabelScanResult;
}

const PROMPT = `This is a photo of a food package's Nutrition Facts label. Read it carefully and extract the fields in the schema, normalizing every nutrient amount to a per-100-gram basis — labels state amounts per serving, so use the serving size in grams printed on the label to convert (e.g. a 55g serving with 220 calories is 400 calories per 100g). Also report the serving size in grams and the label's own serving description (e.g. "2/3 cup") separately, unconverted. \`caloriesPer100g\` must always be in kilocalories (Calories/kcal) — if the label's energy row is given only in kilojoules (kJ), convert it to kcal by dividing by 4.184 before applying the per-100g conversion (e.g. "Energy 1046kJ per 100g" is 1046 / 4.184 ≈ 250 kcal per 100g). If a label shows both kJ and kcal, use the kcal figure directly rather than converting. If the product name or brand is visible anywhere in the photo, include it. Sodium is in milligrams; every other nutrient is in grams. If a field isn't present on the label or you can't determine it confidently, return null for that field — never guess or estimate a value.`;

export async function scanNutritionLabel(accessToken: string, imageBuffer: Buffer, mediaType: "image/jpeg"): Promise<LabelScanResult> {
  const text = await generateAiText(accessToken, "labelScan", {
    prompt: PROMPT,
    images: [{ buffer: imageBuffer, mediaType }],
    maxTokens: 1024,
    jsonSchema: LABEL_SCAN_JSON_SCHEMA,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Couldn't read a nutrition label from that photo");
  }
  return coerceLabelScanResult(parsed);
}
