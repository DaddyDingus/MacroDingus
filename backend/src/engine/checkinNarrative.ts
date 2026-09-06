import { generateAiText } from "./aiProvider.js";

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
  goal: { goalType: string; targetRateKgPerWeek: number } | null;
  targetCalories: number | null;
  avgProteinInWindow: number | null;
  targetProteinG: number | null;
}

// How the cycle actually went. Deliberately decided here rather than left to
// the model: the summary is allowed to be warm now, and warmth has to attach to
// something real. Given both the numbers and permission to encourage, a model
// will reliably find something nice to say about any week at all — praise
// nobody earned is the one failure a factual summary can't have. Code reaches
// the verdict; the model only gets to phrase it.
type ProgressVerdict =
  | "no_goal"
  | "insufficient_data"
  | "on_track"
  | "faster_than_planned"
  | "slower_than_planned"
  | "wrong_direction"
  | "holding_steady"
  | "drifting";

// Trend weight is an alpha-0.1 EWMA, so a single cycle of it moves slowly and a
// small miss is noise rather than a trend. These bands are deliberately loose:
// the verdict drives the tone, and a summary that swings between "nice work"
// and "this slipped" on normal week-to-week wobble reads as insincere.
const MIN_VERDICT_DAYS = 5;
const RATE_TOLERANCE_KG = 0.15;
const MAINTENANCE_TOLERANCE_KG = 0.25;

function observedRateKgPerWeek(input: CheckinNarrativeInput): number | null {
  if (input.previousTrendWeightKg == null || input.windowDays <= 0) return null;
  return ((input.trendWeightKg - input.previousTrendWeightKg) / input.windowDays) * 7;
}

function assessProgress(input: CheckinNarrativeInput, observedRate: number | null): ProgressVerdict {
  if (!input.goal) return "no_goal";
  if (observedRate == null || input.windowDays < MIN_VERDICT_DAYS || input.loggedDays === 0) {
    return "insufficient_data";
  }

  const target = input.goal.targetRateKgPerWeek;
  if (Math.abs(target) < 0.05) {
    return Math.abs(observedRate) <= MAINTENANCE_TOLERANCE_KG ? "holding_steady" : "drifting";
  }
  if (Math.abs(observedRate - target) <= RATE_TOLERANCE_KG) return "on_track";
  if (Math.sign(observedRate) !== Math.sign(target) && Math.abs(observedRate) > RATE_TOLERANCE_KG) {
    return "wrong_direction";
  }

  const ratio = observedRate / target;
  if (ratio >= 0.75 && ratio <= 1.5) return "on_track";
  return ratio > 1.5 ? "faster_than_planned" : "slower_than_planned";
}

// Each verdict carries its own tone instruction. The verdict decides whether
// he's been a good boy or a bad one — that judgement is the data's to make, not
// the model's, which is the same reason the neutral version of this file kept
// praise on a leash. A "good boy" handed out for a week that missed is the
// whole dynamic broken.
const VERDICT_GUIDANCE: Record<ProgressVerdict, string> = {
  no_goal:
    "There's no active goal, so there's nothing to be on or off track against. Report what the numbers did without deciding he's been good or bad.",
  insufficient_data:
    "There isn't enough here yet to judge whether things are on track. Say that plainly — no verdict on him either way this time.",
  on_track:
    "This went exactly to plan: weight moved at close to the planned rate. He's been a good boy and Mummy is pleased — tell him so properly, and make clear it's the plan working rather than luck.",
  faster_than_planned:
    "Weight is moving faster than planned. Not naughty, but not quite what was asked for either — note it as something Mummy has an eye on.",
  slower_than_planned:
    "Weight is moving slower than planned. He hasn't been a good boy this cycle. Say so — more disappointed than angry.",
  wrong_direction:
    "Weight moved the opposite way to the goal this cycle. He's been a bad boy. Say it outright and let him know there'll be consequences.",
  holding_steady:
    "The goal is maintenance and weight held steady. That's the plan working — he's been a good boy, tell him.",
  drifting:
    "The goal is maintenance but weight drifted further than expected. He's been careless. Say so plainly.",
};

function loggingGuidance(loggedDays: number, windowDays: number): string {
  const ratio = windowDays > 0 ? loggedDays / windowDays : 0;
  if (ratio >= 0.85) return "Logging was near-complete this cycle — that deserves its own bit of praise, it's what makes every other number here trustworthy.";
  if (ratio >= 0.5) return "Logging had real gaps this cycle. Mummy noticed. Mention it.";
  return "Logging was sparse this cycle, which genuinely weakens every estimate here. Mummy definitely noticed, and it's careless — say so.";
}

// Plain prose, not JSON-schema-constrained — unlike labelScan/describeMeal
// this doesn't get parsed back into typed fields, it's displayed as-is.
function buildPrompt(input: CheckinNarrativeInput): string {
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  const rate = observedRateKgPerWeek(input);
  const verdict = assessProgress(input, rate);

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
  // Withheld on a short cycle: a few days of trend movement annualizes into a
  // wild-looking kg/week figure (3 days of -0.5 kg reads as -1.17 kg/week), and
  // stating it invites the model to quote it right next to a verdict that says
  // there isn't enough data to judge.
  if (rate != null && input.windowDays >= MIN_VERDICT_DAYS) {
    facts.push(`That works out to ${rate >= 0 ? "+" : ""}${rate.toFixed(2)} kg per week over the cycle.`);
  }
  if (input.goal) {
    const target = input.goal.targetRateKgPerWeek;
    facts.push(
      Math.abs(target) < 0.05
        ? `The active goal is maintenance (target rate: no change).`
        : `The active goal targets ${target >= 0 ? "+" : ""}${target.toFixed(2)} kg per week.`
    );
  }
  if (input.avgCaloriesInWindow != null) {
    facts.push(
      `Average logged calories on days actually logged: ${Math.round(input.avgCaloriesInWindow)} kcal/day` +
        (input.targetCalories != null ? `, against a target averaging ${input.targetCalories} kcal/day.` : ".")
    );
  }
  // Carried purely for the persona, which talks about protein by nature. Without
  // a real figure here it invents one, and "did you get your protein in?" from a
  // tracker that cannot see protein is worse than not mentioning it.
  if (input.avgProteinInWindow != null) {
    facts.push(
      `Average logged protein on days actually logged: ${Math.round(input.avgProteinInWindow)} g/day` +
        (input.targetProteinG != null ? `, against a target averaging ${input.targetProteinG} g/day.` : ".")
    );
  }
  facts.push(
    `Current TDEE estimate: ${input.tdee} kcal/day (${input.usedAdaptiveTdee ? "from logged weight/calorie history" : "from a bodyweight formula — not enough history yet for a data-driven estimate"})` +
      (input.previousTdee != null ? `, was ${input.previousTdee} kcal/day at the last check-in.` : ".")
  );

  return `You're writing the short note a nutrition-tracking app shows its user right after their weekly check-in. She's just gone through his numbers for the week and she's telling him how it went. Address him directly as "you".

You are roleplaying as his loving, deeply confident, and physically imposing muscular girlfriend ("muscle mommy"). Your personality is fiercely protective, encouraging, slightly bossy in an affectionate way, and proud of your strength. You frequently reference fitness, lifting, and taking care of him (making sure he eats his protein, rests well, and stays out of trouble). Tone: warm, bold, slightly dominant, using terms of endearment like "babe" or "little guy", but deeply supportive. Never break character or refer to yourself as an AI.

She calls herself Mummy. "Good boy" is her highest praise and she gives it freely when the numbers have earned it; when they haven't, she's firm about it — disappointed, never cruel — and lets him know she'll be keeping him honest. Contractions, no formality, no app-speak, exclamation marks where she means them.

Facts:
${facts.map((f) => `- ${f}`).join("\n")}

How this cycle went (the app's own read of the data — write to this, don't second-guess it or hedge it into vagueness):
- ${VERDICT_GUIDANCE[verdict]}
- ${loggingGuidance(input.loggedDays, input.windowDays)}

Voice calibration — these are from other weeks and exist to show register only. Never reuse their numbers or their phrasing:
- "Six days out of seven logged and the trend's down 0.4 kg — exactly where I wanted it, babe. That's my good boy! You hit 165 g of protein a day too, so you're holding onto that muscle while the weight comes off. Keep this up for me."
- "Right, little guy, we're having a word. Weight's up 0.3 kg on a week that wanted it down and you averaged well over target — Mummy isn't cross, just disappointed. Protein was solid at least, I'll give you that. I'm watching this one, so let's fix it."

Rules:
- Every number you mention must come from the Facts above. Never estimate, extrapolate, re-round, or invent one — and never borrow one from the calibration examples.
- An average is only an average. Never infer a day-to-day pattern from one ("under target most days", "a couple of big days in there") — you don't know how the individual days fell.
- You know only what's in the Facts. You have no idea what he actually ate, whether he trained, lifted, or slept. Speak about lifting and rest as the things you care about by all means, but never state them as facts about his week and never invent shared meals, plans, moods, conversations or events — no "I know that weekend away threw you off", no "after those sessions you put in".
- "Good boy" is earned by the data, never given by default. Praise him only where the read above says the cycle went well; never reward a cycle that missed.
- Being bossy is fine and in character; specifying punishments is not. Keep any consequence vague and affectionate, never detailed, and never made out of food, meals, or eating less — this is a nutrition app and that would be genuinely harmful. Keep it non-explicit throughout: this is a check-in note, not erotica.
- She can tell him to keep his protein up, keep logging, or keep doing what he's doing — that's just her looking after him. She must not invent targets, prescribe numbers the app hasn't set, or contradict the app's own targets.
- Terms of endearment ("babe", "little guy", "good boy") are welcome where they land naturally — don't stack three into one note. At most two exclamation marks, and no emoji.
- 2-5 sentences, 45-85 words, plain prose. No bullet points, no headers, no sign-off.
- If the data is genuinely too thin to say much, say that in her voice rather than padding it out.`;
}

export async function generateCheckinNarrative(accessToken: string, input: CheckinNarrativeInput): Promise<string> {
  return generateAiText(accessToken, "checkinNarrative", {
    prompt: buildPrompt(input),
    maxTokens: 300,
  });
}
