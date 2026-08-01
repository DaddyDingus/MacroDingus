import { addDays } from "./date";

// Consecutive tracked days counting backward from today. Zero if today
// itself isn't tracked yet — matches MacroFactor's own behavior (a streak
// is "how many days in a row including today", not "how many days in a row
// as of your last entry"), so logging nothing yet today reads as streak 0
// even with a long run of prior days, rather than quietly still showing
// yesterday's count.
export function computeCurrentStreak(activeDates: Set<string>, today: string): number {
  if (!activeDates.has(today)) return 0;
  let streak = 0;
  let cursor = today;
  while (activeDates.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
