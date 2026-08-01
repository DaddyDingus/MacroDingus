export type GoalTypeValue = "cut" | "bulk" | "maintain";

// Evidence-based weekly rate-of-change ranges, expressed as % of current
// trend body weight per week (not a flat kg/week number — a fixed kg
// figure doesn't scale with body size, so a fixed "-0.5kg/week" is
// conservative for a 100kg person and aggressive for a 55kg person).
//
// Cut: 0.5-1.0%/week. Helms, Aragon & Fitschen 2014 (JISSN, "Evidence-based
// recommendations for natural bodybuilding contest preparation"): caloric
// intake should target "bodyweight losses of approximately 0.5 to 1%/wk to
// maximize muscle retention." Corroborated by Garthe et al. 2011 (Int J
// Sport Nutr Exerc Metab), which directly compared a 0.7%/wk vs 1.4%/wk
// rate in trained athletes and found the faster rate produced significantly
// worse strength and lean-mass outcomes for the same total fat loss.
//
// Bulk: 0.25-0.5%/week. The consensus "lean bulk" rate across the
// post-Helms/Aragon strength-nutrition literature (e.g. Iraki et al. 2019,
// "Nutrition Recommendations for Bodybuilders in the Off-Season", J Funct
// Morphol Kinesiol) — fast enough for a meaningful surplus signal, slow
// enough that the bulk of the gain is lean tissue rather than fat.
//
// Maintain: no rate to recommend — null.
const RATE_RANGE_PCT_BW: Record<GoalTypeValue, { min: number; max: number } | null> = {
  cut: { min: -1.0, max: -0.5 },
  bulk: { min: 0.25, max: 0.5 },
  maintain: null,
};

// Flat kg/week fallback for the rare case this screen is reached before a
// first weigh-in exists (no trend weight yet to scale a % against) — same
// numbers this screen used before the %BW-based ranges above existed.
const FALLBACK_FLAT_KG_PER_WEEK: Record<GoalTypeValue, number> = { cut: -0.5, bulk: 0.25, maintain: 0 };

export function recommendedRateRangeKgPerWeek(
  goalType: GoalTypeValue,
  trendWeightKg: number | null
): { min: number; max: number } | null {
  const pct = RATE_RANGE_PCT_BW[goalType];
  if (!pct || trendWeightKg === null) return null;
  return { min: (pct.min / 100) * trendWeightKg, max: (pct.max / 100) * trendWeightKg };
}

export function isWithinRecommendedRange(rateKgPerWeek: number, goalType: GoalTypeValue, trendWeightKg: number | null): boolean {
  const range = recommendedRateRangeKgPerWeek(goalType, trendWeightKg);
  if (!range) return false;
  return rateKgPerWeek >= range.min - 1e-9 && rateKgPerWeek <= range.max + 1e-9;
}

// Seeds the rate slider at the midpoint of the recommended range (rather
// than its edge) when a goal type is first selected.
export function defaultRateKgPerWeek(goalType: GoalTypeValue, trendWeightKg: number | null): number {
  const range = recommendedRateRangeKgPerWeek(goalType, trendWeightKg);
  if (!range) return FALLBACK_FLAT_KG_PER_WEEK[goalType];
  return Math.round(((range.min + range.max) / 2) * 100) / 100;
}

// Slider bounds beyond the recommended zone — scaled off the recommended
// range's own max, not a flat %BW headroom, so the recommended band always
// takes up a consistent, prominent share of the track (~1/3 of it, given
// both our ranges' min is exactly half their max) rather than shrinking to
// a sliver whenever the bound is wide. A flat headroom (the old approach)
// is honest but reads as broken next to MacroFactor's own goal-rate slider,
// where the recommended zone is clearly the dominant visual feature, not a
// thin marker somewhere on a mostly-empty track. 1.5x still leaves real
// room past the recommended max for a deliberately faster/slower custom
// choice (e.g. a cut tops out at 1.5%/wk, still short of Garthe et al.
// 2011's 1.4%/wk "fast reduction" arm that underperformed 0.7%/wk) — this
// isn't meant to be a hard cap, just no longer needs to also be the primary
// visual anchor.
//
// One-sided per goal type: a cut can only slide toward weight loss (down to
// 0), a bulk only toward weight gain (up from 0) — a cut goal shouldn't be
// draggable into a surplus rate or vice versa. Maintain has nothing to
// slide (always 0); its {min:0,max:0} is never actually rendered as a
// slider since the wizard skips straight to the summary step for it.
const SLIDER_BOUND_MULTIPLIER = 1.5;

export function rateSliderBoundsKgPerWeek(goalType: GoalTypeValue, trendWeightKg: number | null): { min: number; max: number } {
  const range = recommendedRateRangeKgPerWeek(goalType, trendWeightKg);
  if (!range) {
    // No trend weight yet to scale a % against — same flat fallback the
    // screen used before the %BW-based ranges existed.
    if (goalType === "cut") return { min: -1.5, max: 0 };
    if (goalType === "bulk") return { min: 0, max: 1.5 };
    return { min: 0, max: 0 };
  }
  const bound = Math.max(Math.abs(range.min), Math.abs(range.max)) * SLIDER_BOUND_MULTIPLIER;
  if (goalType === "cut") return { min: -bound, max: 0 };
  if (goalType === "bulk") return { min: 0, max: bound };
  return { min: 0, max: 0 };
}
