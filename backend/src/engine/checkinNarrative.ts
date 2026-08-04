import { getAnthropicClient } from "./anthropicClient.js";

export interface CheckinNarrativeInput {
  isFirstCheckin: boolean;
  windowDays: number;
  loggedDays: number;
  trendWeightKg: number;
  previousTrendWeightKg: number | null;
  tdee: number;
  previousTdee: number | null;
  usedAdaptiveTdee: boolean;
  avgCaloriesInWindow: number | null;
}

// Plain prose, not JSON-schema-constrained — unlike labelScan/describeMeal
// this doesn't get parsed back into typed fields, it's displayed as-is.
function buildPrompt(input: CheckinNarrativeInput): string {
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  const facts: string[] = [];
  facts.push(
    input.isFirstCheckin
      ? "This is the user's first check-in — there's no previous check-in to compare against."
      : `${days(input.windowDays)} since the last check-in.`
  );
  facts.push(`Logged calories on ${input.loggedDays} of those ${days(input.windowDays)}.`);
  facts.push(
    `Current trend weight: ${input.trendWeightKg.toFixed(1)} kg` +
      (input.previousTrendWeightKg != null ? ` (was ${input.previousTrendWeightKg.toFixed(1)} kg at the last check-in).` : ".")
  );
  if (input.avgCaloriesInWindow != null) {
    facts.push(`Average logged calories on days actually logged: ${Math.round(input.avgCaloriesInWindow)} kcal/day.`);
  }
  facts.push(
    `Current TDEE estimate: ${input.tdee} kcal/day (${input.usedAdaptiveTdee ? "from logged weight/calorie history" : "from a bodyweight formula — not enough history yet for a data-driven estimate"})` +
      (input.previousTdee != null ? `, was ${input.previousTdee} kcal/day at the last check-in.` : ".")
  );

  return `You're generating a short, strictly factual weekly summary for a nutrition-tracking app, based only on the numbers below. This is NOT a coach and must never sound like one.

Facts:
${facts.map((f) => `- ${f}`).join("\n")}

Write 2-4 short sentences that plainly restate what happened, in the numbers' own terms. Rules:
- No encouragement, congratulations, praise, or motivational language ("great job", "keep it up", "you're crushing it") — report facts, not sentiment.
- No advice or recommendations ("try to log more consistently", "consider eating more protein") — this is a summary, not coaching.
- Don't editorialize a number's meaning beyond what it plainly says — e.g. don't call a small weight change "amazing" or a missed log day "concerning", just state it.
- If the data is too sparse to say much (e.g. this is the first check-in), say that plainly rather than padding with filler.
- Plain prose, no bullet points, no headers, no emoji.`;
}

export async function generateCheckinNarrative(userId: string, input: CheckinNarrativeInput): Promise<string> {
  const response = await getAnthropicClient(userId).messages.create({
    model: "claude-sonnet-5",
    max_tokens: 300,
    messages: [{ role: "user", content: buildPrompt(input) }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("No narrative returned");
  return textBlock.text.trim();
}
