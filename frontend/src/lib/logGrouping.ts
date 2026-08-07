import type { LogEntry } from "../api/types";
import { hourOfLoggedAt } from "./date";

export interface LogGroup {
  id: string;
  hour: number;
  entries: LogEntry[];
}

export interface GroupTotals {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export function sumGroupTotals(entries: LogEntry[]): GroupTotals {
  return entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.nutrition.calories,
      protein: acc.protein + e.nutrition.protein,
      fat: acc.fat + e.nutrition.fat,
      carbs: acc.carbs + e.nutrition.carbs,
    }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

// Fixed calendar-hour buckets (matches MacroFactor's own food timeline), not
// a rolling minutes-since-last-item window — a prior version used the latter
// and needed constant re-tuning of the threshold (60min, then 20, then 10)
// since any single number is either too eager to merge a slow trickle of
// entries or too quick to split a genuine one-sitting meal. Hour buckets need
// no tuning and self-explain via the header ("10 AM"/"11 AM"), and each row
// still carries its own exact time (see FoodItemCard) so nothing is actually
// lost by two entries 43 minutes apart sharing a bucket. Entries are assumed
// to share the same `date` (this only ever runs on one day's log at a time).
export function groupLogEntriesByTime(entries: LogEntry[]): LogGroup[] {
  const sorted = [...entries].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const groups: LogGroup[] = [];

  for (const entry of sorted) {
    const hour = hourOfLoggedAt(entry.loggedAt);
    const current = groups[groups.length - 1];
    if (current && current.hour === hour) {
      current.entries.push(entry);
    } else {
      groups.push({ id: entry.id, hour, entries: [entry] });
    }
  }

  return groups;
}
