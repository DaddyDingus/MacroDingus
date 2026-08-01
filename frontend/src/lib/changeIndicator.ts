export type ChangeDirection = "increase" | "decrease" | "none";

// Shared by the Weight Trend and Expenditure screens' "Changes" cards and
// history rows. epsilon is required rather than defaulted — a kg-scale
// threshold and a kcal-scale one are wildly different magnitudes, so a
// shared default would be silently wrong for one of the two callers.
export function changeDirection(delta: number | null, epsilon: number): ChangeDirection {
  if (delta === null || Math.abs(delta) < epsilon) return "none";
  return delta > 0 ? "increase" : "decrease";
}

export function changeDirectionLabel(direction: ChangeDirection): string {
  if (direction === "increase") return "Increase";
  if (direction === "decrease") return "Decrease";
  return "No change";
}
