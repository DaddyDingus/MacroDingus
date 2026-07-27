import type { LogEntry } from "../api/types";
import { minutesBetweenLoggedAt } from "./date";

const GROUP_WINDOW_MINUTES = 60;

export interface LogGroup {
  id: string;
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

// A rolling/pairwise window, not a fixed-start bucket: an entry joins the
// current group if it's within GROUP_WINDOW_MINUTES of the *previous* entry
// added to that group (not the group's first entry), so a slow trickle of
// items each ~25 minutes apart still chains into one group, while any single
// gap over the window always starts a new one. Entries are assumed to share
// the same `date` (this only ever runs on one day's log at a time), so plain
// minutes-of-day arithmetic is enough — no cross-midnight handling needed.
export function groupLogEntriesByTime(entries: LogEntry[]): LogGroup[] {
  const sorted = [...entries].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const groups: LogGroup[] = [];

  for (const entry of sorted) {
    const current = groups[groups.length - 1];
    const lastEntry = current?.entries[current.entries.length - 1];
    if (current && lastEntry && minutesBetweenLoggedAt(lastEntry.loggedAt, entry.loggedAt) <= GROUP_WINDOW_MINUTES) {
      current.entries.push(entry);
    } else {
      groups.push({ id: entry.id, entries: [entry] });
    }
  }

  return groups;
}
