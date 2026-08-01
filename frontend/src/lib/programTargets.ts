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
// startedAt is a full ISO timestamp (not a bare date), so comparisons use
// its date-only prefix.
export function activeProgramForDate(programs: Program[], date: string): Program | null {
  let active: Program | null = null;
  for (const p of programs) {
    const startDate = p.startedAt.slice(0, 10);
    if (startDate > date) continue;
    if (!active) {
      active = p;
      continue;
    }
    const activeStartDate = active.startedAt.slice(0, 10);
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
