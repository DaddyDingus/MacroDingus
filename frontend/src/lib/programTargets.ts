import type { Program } from "../api/programs";

// UTC-safe, same discipline as the trend-weight engine's date math — avoids
// a server/browser-timezone-dependent off-by-one on which weekday a date
// string actually falls on.
export function dayOfWeekFromDateString(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Same "latest startedAt <= date, createdAt tiebreak" shape as
// lib/checkins.ts's activeCheckinForDate — programs are sparse historical
// events just like check-ins, so the same resolution logic applies.
// startedDate/endedDate are resolved in APP_TIME_ZONE by the backend; slicing
// their UTC timestamps can otherwise select the previous calendar day.
export function activeProgramForDate(programs: Program[], date: string): Program | null {
  let active: Program | null = null;
  for (const p of programs) {
    const startDate = p.startedDate;
    if (startDate > date) continue;
    // Keep the ending calendar day attributable to the program (a same-day
    // replacement wins via the tiebreak below), but never carry an ended
    // program's targets indefinitely into later dates.
    if (p.endedDate !== null && p.endedDate < date) continue;
    if (!active) {
      active = p;
      continue;
    }
    const activeStartDate = active.startedDate;
    if (startDate > activeStartDate || (startDate === activeStartDate && p.createdAt > active.createdAt)) active = p;
  }
  return active;
}

export interface DayTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

// Resolves the active program for `date`, then that program's row for
// date's weekday. This replaces every call site that used to read
// .targetCalories/etc. straight off a Checkin — targets can now vary by
// weekday, which a single flat set of fields on one checkin row can't
// represent (see backend/src/db/schema.ts's Phase 1/Phase 2 migration
// notes on checkins losing its target columns).
export function targetsForDate(programs: Program[], date: string): DayTargets | null {
  const program = activeProgramForDate(programs, date);
  if (!program) return null;
  const dow = dayOfWeekFromDateString(date);
  const day = program.days.find((d) => d.dayOfWeek === dow);
  if (!day) return null;
  return { calories: day.targetCalories, proteinG: day.targetProteinG, carbsG: day.targetCarbsG, fatG: day.targetFatG };
}

// Layers a "Carry Forward Shortfall" adjustment on top of a day's base
// targets (see api/adjustments.ts). `undefined` covers the adjustment
// query's not-yet-loaded state the same as `null` (no adjustment) — a
// caller mid-fetch should render the base target, not a boost that might
// not apply.
export function applyAdjustment(
  targets: DayTargets,
  adjustment: { kcal: number; proteinG: number; carbsG: number; fatG: number } | null | undefined
): DayTargets {
  if (!adjustment) return targets;
  return {
    calories: targets.calories + adjustment.kcal,
    proteinG: targets.proteinG + adjustment.proteinG,
    carbsG: targets.carbsG + adjustment.carbsG,
    fatG: targets.fatG + adjustment.fatG,
  };
}

// Layers every delta source onto a day's base targets: a Carry Forward
// Shortfall boost and an event-plan delta both apply, and they SUM rather
// than one winning — they answer different questions ("I under-ate yesterday"
// vs "Saturday is a big dinner") and a user can legitimately have both on one
// day. Event-plan deltas are signed; a plan's offset days are negative, which
// is why this can't reuse applyAdjustment's positive-only shape.
//
// Prefer lib/useResolvedTargets.ts's hook over calling this directly — it
// owns fetching the pieces as well as combining them.
export function applyDayDeltas(
  targets: DayTargets,
  adjustment: { kcal: number; proteinG: number; carbsG: number; fatG: number } | null | undefined,
  planDelta: { kcal: number; proteinG: number; carbsG: number; fatG: number } | null | undefined
): DayTargets {
  const withAdjustment = applyAdjustment(targets, adjustment);
  if (!planDelta) return withAdjustment;
  return {
    // A plan can never drive a displayed target below zero, whatever the
    // stored deltas say.
    calories: Math.max(0, withAdjustment.calories + planDelta.kcal),
    proteinG: Math.max(0, withAdjustment.proteinG + planDelta.proteinG),
    carbsG: Math.max(0, withAdjustment.carbsG + planDelta.carbsG),
    fatG: Math.max(0, withAdjustment.fatG + planDelta.fatG),
  };
}
