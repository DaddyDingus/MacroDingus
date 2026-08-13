import { usePrograms } from "../api/programs";
import { useAdjustment } from "../api/adjustments";
import { useEventPlanDeltas, planDeltaForDate } from "../api/eventPlans";
import { targetsForDate, applyDayDeltas, type DayTargets } from "./programTargets";

export interface ResolvedDayTargets {
  targets: DayTargets | null;
  // The base weekday template, before anything was layered on. Screens that
  // want to explain *why* a target moved need both numbers.
  baseTargets: DayTargets | null;
  hasAdjustment: boolean;
  planDelta: ReturnType<typeof planDeltaForDate>;
}

// The single place a day's real target is assembled: weekday template, plus a
// Carry Forward Shortfall boost, plus any event-plan delta.
//
// This exists because there ISN'T one for the first two. TodayScreen and
// QuickActionFlow each resolved targets by hand, and when the second one was
// added it forgot the adjustment entirely — a carried-forward day showed
// boosted macro bars from TodayScreen's own AddFoodSheet and un-boosted ones
// from the FAB's, same value, two call sites, one wrong (fixed 2026-08-08).
// Event plans add a third delta source, which would have been a third chance
// to make that same mistake. Every AddFoodSheet mount still trusts its
// `targets` prop as pre-resolved — so new callers should use this hook rather
// than reassembling the pieces.
export function useResolvedTargets(date: string): ResolvedDayTargets {
  const programs = usePrograms();
  const adjustment = useAdjustment(date);
  const planDeltas = useEventPlanDeltas();

  const baseTargets = targetsForDate(programs.data ?? [], date);
  const planDelta = planDeltaForDate(planDeltas.data, date);
  const targets = baseTargets ? applyDayDeltas(baseTargets, adjustment.data, planDelta) : null;

  return {
    targets,
    baseTargets,
    hasAdjustment: !!adjustment.data,
    planDelta,
  };
}
