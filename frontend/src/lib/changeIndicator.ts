export type ChangeDirection = "increase" | "decrease" | "none";

// Shared by the Weight Trend and Expenditure screens' "Changes" cards and
// history rows. epsilon is required rather than defaulted — a kg-scale
// threshold and a kcal-scale one are wildly different magnitudes, so a
// shared default would be silently wrong for one of the two callers.
export function changeDirection(delta: number | null, epsilon: number): ChangeDirection {
  if (delta === null || Math.abs(delta) < epsilon) return "none";
  return delta > 0 ? "increase" : "decrease";
}

// A change label is only truthful if it's decided on the number actually
// printed beside it. Weight screens render one decimal, in the user's display
// unit — so round and convert *first*, then compare with half the last shown
// digit. Comparing raw values put an "Increase" beside a row reading 79.3 kg
// whose predecessor also read 79.3 and said "Decrease" (a real +0.01 kg EWMA
// step). A fixed kg epsilon is also ~2.2x too tight once rendered in lb.
export const DISPLAY_EPSILON = 0.05;

export function roundToDisplay(n: number): number {
  return Math.round(n * 10) / 10;
}

export function changeDirectionLabel(direction: ChangeDirection): string {
  if (direction === "increase") return "Increase";
  if (direction === "decrease") return "Decrease";
  return "No change";
}
