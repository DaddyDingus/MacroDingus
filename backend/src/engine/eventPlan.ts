// Event plan distribution — spreads a high-Calorie day's surplus across the
// days around it so the week still lands on target.
//
// Pure and side-effect-free, in the same spirit as planCheckin(): the routes
// call this to preview and again to commit, and the two agree because it's
// deterministic on the same inputs. Nothing here reads the clock or the DB —
// the caller decides which days are eligible (the past isn't) and what the
// base targets are.

export interface DayTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface OffsetDayInput {
  date: string;
  targets: DayTargets;
  // Calories already added or removed from this day by *other* active plans
  // (and by a carry-forward adjustment). Caps have to measure against what
  // the day will actually resolve to, or two overlapping plans each shave
  // "25% of target" off the same day and compound into something unsafe.
  existingDeltaKcal: number;
}

export interface GeneratedPlanDay {
  date: string;
  kcalDelta: number;
  proteinDelta: number;
  carbsDelta: number;
  fatDelta: number;
}

export interface DistributionResult {
  days: GeneratedPlanDay[];
  // What the event day is over its own base target by — the amount the
  // window is being asked to recover.
  surplusKcal: number;
  // What the window could actually absorb once caps and the Calorie floor
  // were applied.
  recoveredKcal: number;
  // surplus - recovered. Reported rather than hidden: a plan that only
  // recovers 520 of 600 should say so, not quietly under-deliver and let the
  // user believe the week is square.
  shortfallKcal: number;
}

// No single day may lose more than this share of its own target. Deliberately
// tighter than the carry-forward sheet's 50% Calorie cap: adding food to a day
// is comfortable, taking it away is not, and a quarter of a day's target is
// about where a cut stops being "eat a bit lighter" and starts being a
// different diet. The floor check below is the hard safety limit; this is the
// comfort one.
export const MAX_DAILY_CUT_FRACTION = 0.25;

// Used when the active program is manual and carries no calorieFloorKcal of
// its own. Matches the coached wizard's lower bound rather than inventing a
// new number.
export const DEFAULT_CALORIE_FLOOR_KCAL = 1200;

// Protein is never touched. Daily protein spread matters more for MPS than
// the weekly total (the same reasoning that caps carry-forward's protein at
// 25% while Calories get 50%), and protein is the last macro you'd want to
// cut on a day you're already eating less. The whole adjustment comes out of
// carbs and fat, in proportion to how many Calories each currently supplies.
function splitAcrossCarbsAndFat(
  kcal: number,
  targets: DayTargets
): { carbsDelta: number; fatDelta: number } {
  const carbsKcal = targets.carbsG * 4;
  const fatKcal = targets.fatG * 9;
  const nonProteinKcal = carbsKcal + fatKcal;
  // A target with no carbs and no fat is not a real program day, but a
  // divide-by-zero here would poison every downstream number with NaN.
  if (nonProteinKcal <= 0) return { carbsDelta: 0, fatDelta: 0 };
  const carbsShare = carbsKcal / nonProteinKcal;
  return {
    carbsDelta: round1((kcal * carbsShare) / 4),
    fatDelta: round1((kcal * (1 - carbsShare)) / 9),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// How many Calories this day can give up: the gentler of the comfort cap and
// the hard floor, measured against the day's already-adjusted total.
function capacityFor(day: OffsetDayInput, floorKcal: number): number {
  const comfortCap = day.targets.calories * MAX_DAILY_CUT_FRACTION;
  const resolved = day.targets.calories + day.existingDeltaKcal;
  const floorRoom = resolved - floorKcal;
  return Math.max(0, Math.min(comfortCap, floorRoom));
}

// Even split, then water-fill: days that hit their cap keep what they can
// take and the remainder redistributes across whoever still has room, rather
// than the whole plan silently under-recovering because one day was already
// near the floor. Terminates because each pass either places everything or
// removes at least one day from the pool.
function allocateCuts(days: OffsetDayInput[], surplusKcal: number, floorKcal: number): Map<string, number> {
  const cuts = new Map<string, number>();
  const capacity = new Map<string, number>();
  for (const d of days) {
    cuts.set(d.date, 0);
    capacity.set(d.date, capacityFor(d, floorKcal));
  }

  let remaining = surplusKcal;
  let pool = days.filter((d) => (capacity.get(d.date) ?? 0) > 0);

  while (remaining > 0.5 && pool.length > 0) {
    const share = remaining / pool.length;
    const nextPool: OffsetDayInput[] = [];
    for (const d of pool) {
      const room = capacity.get(d.date)!;
      const take = Math.min(share, room);
      cuts.set(d.date, cuts.get(d.date)! + take);
      capacity.set(d.date, room - take);
      remaining -= take;
      if (room - take > 0.5) nextPool.push(d);
    }
    pool = nextPool;
  }

  return cuts;
}

export interface DistributionInput {
  // The event day's own base targets, and what the user expects to eat (or
  // actually ate) that day.
  eventTargets: DayTargets;
  eventKcal: number;
  eventDate: string;
  // 'planned' raises the event day's target to eventKcal so the day reads
  // normally while it's happening. 'recovery' leaves the logged day alone —
  // retargeting a day after the fact would make an over-eaten day render as
  // on-target, which the diary should never claim.
  kind: "planned" | "recovery";
  offsetDays: OffsetDayInput[];
  calorieFloorKcal: number | null;
}

export function distributeEventPlan(input: DistributionInput): DistributionResult {
  const floorKcal = input.calorieFloorKcal ?? DEFAULT_CALORIE_FLOOR_KCAL;
  const surplusKcal = Math.max(0, Math.round(input.eventKcal - input.eventTargets.calories));

  const days: GeneratedPlanDay[] = [];

  // The event day itself carries the full surplus on a planned plan, even
  // when the window can't recover all of it: the target should match what the
  // user actually intends to eat. The unrecovered remainder surfaces as
  // shortfallKcal instead of being quietly shaved off the headline.
  if (input.kind === "planned" && surplusKcal > 0) {
    const macros = splitAcrossCarbsAndFat(surplusKcal, input.eventTargets);
    days.push({
      date: input.eventDate,
      kcalDelta: surplusKcal,
      proteinDelta: 0,
      carbsDelta: macros.carbsDelta,
      fatDelta: macros.fatDelta,
    });
  }

  const cuts = allocateCuts(input.offsetDays, surplusKcal, floorKcal);
  let recoveredKcal = 0;
  // Rounding each day independently can overshoot the surplus (650 across 4
  // days rounds to 163 four times = 652, taking back more than was owed), so
  // each cut is also clamped to what's actually left to place. The last day
  // absorbs the residual instead of every day carrying a half-Calorie error.
  let leftToPlace = surplusKcal;
  for (const d of input.offsetDays) {
    const cut = Math.min(Math.round(cuts.get(d.date) ?? 0), leftToPlace);
    if (cut <= 0) continue;
    leftToPlace -= cut;
    const macros = splitAcrossCarbsAndFat(cut, d.targets);
    days.push({
      date: d.date,
      kcalDelta: -cut,
      proteinDelta: 0,
      carbsDelta: -macros.carbsDelta,
      fatDelta: -macros.fatDelta,
    });
    recoveredKcal += cut;
  }

  return {
    days,
    surplusKcal,
    recoveredKcal,
    shortfallKcal: Math.max(0, surplusKcal - recoveredKcal),
  };
}
