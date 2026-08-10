import { generateAiText } from "./aiProvider.js";

export interface PhotoCompareResult {
  hasVisibleChange: boolean;
  observations: string[];
}

const PHOTO_COMPARE_JSON_SCHEMA = {
  type: "object",
  properties: {
    hasVisibleChange: { type: "boolean" },
    observations: { type: "array", items: { type: "string" } },
  },
  required: ["hasVisibleChange", "observations"],
  additionalProperties: false,
};

// Deliberately clinical, not a coach — the user explicitly asked for this to
// be unbiased and factual rather than encouraging, so the prompt forbids
// exactly the kind of language a consumer fitness app defaults to. Fed only
// the two images and how many days apart they were taken, never the scale's
// own verdict on weight change — so the model has nothing to anchor on or
// try to confirm, and can only report what it actually sees.
function buildPrompt(daysApart: number): string {
  const days = `${daysApart} day${daysApart === 1 ? "" : "s"}`;
  return `These are two progress photos of the same person, in the same pose, taken ${days} apart — the first is earlier, the second is later. Compare them like a clinical, objective visual assessment, not a coach.

Only report differences you can actually see in the photos: visible muscle definition, midsection/waist shape, shoulder/back width, vascularity, posture, fat distribution — concrete, physical, verifiable-from-the-image observations, nothing else.

Do not use encouraging, congratulatory, or motivational language ("great progress", "keep it up", etc). Do not speculate about weight, body fat percentage, or diet/training based on anything other than what's visibly different between the two images. If there is no clearly visible difference, say so plainly — do not manufacture one just to have something to report; a lack of visible change over ${days} is a completely normal, valid result.

If there is a visible difference, set hasVisibleChange to true and list each concrete observation as a short, flat, factual sentence in observations (no more than 5). Otherwise set hasVisibleChange to false and return an empty observations array.`;
}

export async function comparePhotos(
  userId: string,
  photoA: { buffer: Buffer; mediaType: "image/jpeg" },
  photoB: { buffer: Buffer; mediaType: "image/jpeg" },
  daysApart: number
): Promise<PhotoCompareResult> {
  const responseText = await generateAiText(userId, "photoComparison", {
    prompt: buildPrompt(daysApart),
    images: [photoA, photoB],
    maxTokens: 1024,
    jsonSchema: PHOTO_COMPARE_JSON_SCHEMA,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("Couldn't compare those photos");
  }

  const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const observations = Array.isArray(obj.observations)
    ? obj.observations.filter((o): o is string => typeof o === "string").slice(0, 5)
    : [];
  return { hasVisibleChange: obj.hasVisibleChange === true, observations };
}
