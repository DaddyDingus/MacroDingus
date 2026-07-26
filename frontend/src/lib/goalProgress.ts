// Shared by the Goal Progress bento tile and its detail page, so the two
// numbers never drift apart.
export function computeGoalProgressPercent(startKg: number, goalKg: number, currentKg: number): number {
  const span = goalKg - startKg;
  if (span === 0) return 100;
  const percent = ((currentKg - startKg) / span) * 100;
  return Math.max(0, Math.min(100, percent));
}
