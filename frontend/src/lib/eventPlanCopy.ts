import type { EventPlan } from "../api/eventPlans";
import { formatDayLabel } from "./date";

// Shared wording for "why is this day's target different", used by the Food
// log banner and the Strategy card. Kept in one place because the two have to
// agree — a day reading "-100 for Dinner, Sat 15" while Strategy calls the
// same plan something else is worse than no label at all.
export function planTitle(plan: Pick<EventPlan, "label" | "eventDate" | "kind">): string {
  if (plan.label && plan.label.trim()) return plan.label.trim();
  return plan.kind === "recovery" ? "Recovery" : "Event";
}

// The sentence fragment after the signed Calorie amount on the Food log.
export function planNoteForDate(plans: EventPlan[] | undefined, date: string): string {
  const plan = plans?.find((p) => p.days.some((d) => d.date === date));
  if (!plan) return "from an event plan";
  const title = planTitle(plan);
  if (plan.eventDate === date) return `for ${title}`;
  return `for ${title}, ${formatDayLabel(plan.eventDate)}`;
}
