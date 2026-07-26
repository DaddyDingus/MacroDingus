import type { LogEntry } from "../api/types";

export type ContributorMetric = "calories" | "protein" | "carbs" | "fat";

export interface Contributor {
  foodId: string;
  name: string;
  amount: number;
}

// Merges multiple same-day entries of the same food into one line — matches
// how a person thinks about "what contributed to my protein today," not how
// many separate times it was logged (e.g. chicken breast logged twice in one
// day shows once, summed).
export function topContributors(entries: LogEntry[], metric: ContributorMetric, n = 3): Contributor[] {
  const byFood = new Map<string, Contributor>();
  for (const e of entries) {
    const amount = e.nutrition[metric];
    const existing = byFood.get(e.food.id);
    if (existing) {
      existing.amount += amount;
    } else {
      byFood.set(e.food.id, { foodId: e.food.id, name: e.food.name, amount });
    }
  }
  return [...byFood.values()].sort((a, b) => b.amount - a.amount).slice(0, n);
}
