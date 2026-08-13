import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface EventPlanDay {
  id: string;
  planId: string;
  date: string;
  kcalDelta: number;
  proteinDelta: number;
  carbsDelta: number;
  fatDelta: number;
}

export interface EventPlan {
  id: string;
  userId: string;
  eventDate: string;
  label: string | null;
  kind: "planned" | "recovery";
  eventKcal: number;
  windowMode: "spread" | "week";
  leadDays: number;
  trailDays: number;
  distributionMode: "even" | "custom";
  settledAt: string | null;
  createdAt: string;
  days: EventPlanDay[];
}

// Summed per date across every plan, so a day touched by two plans resolves
// to one number. Layered on top of targetsForDate() exactly like a
// carry-forward adjustment — see lib/programTargets.ts's applyAdjustment.
export interface EventPlanDelta {
  date: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  planIds: string[];
}

export interface PlanPreview {
  days: { date: string; kcalDelta: number; proteinDelta: number; carbsDelta: number; fatDelta: number }[];
  surplusKcal: number;
  recoveredKcal: number;
  shortfallKcal: number;
  eventTargets: { calories: number; proteinG: number; carbsG: number; fatG: number };
  leadDays: number;
  trailDays: number;
}

export interface PlanInput {
  eventDate: string;
  label?: string | null;
  kind: "planned" | "recovery";
  eventKcal: number;
  windowMode: "spread" | "week";
  spreadDays: number;
}

export function useEventPlans() {
  return useQuery({
    queryKey: ["event-plans"],
    queryFn: () => apiFetch<EventPlan[]>("/event-plans"),
  });
}

export function useEventPlanDeltas() {
  return useQuery({
    queryKey: ["event-plan-deltas"],
    queryFn: () => apiFetch<EventPlanDelta[]>("/event-plans/deltas"),
  });
}

// Every mutation invalidates both keys: the plan list drives Strategy, the
// deltas drive every day's resolved target, and a change to one is always a
// change to the other.
function useInvalidatePlans() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["event-plans"] });
    qc.invalidateQueries({ queryKey: ["event-plan-deltas"] });
  };
}

export function usePreviewEventPlan() {
  return useMutation({
    mutationFn: (input: PlanInput) =>
      apiFetch<PlanPreview>("/event-plans/preview", { method: "POST", body: JSON.stringify(input) }),
  });
}

export function useCreateEventPlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: (input: PlanInput) =>
      apiFetch<EventPlan>("/event-plans", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
}

export function useEditEventPlanDays(planId: string) {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: (days: { date: string; kcalDelta: number }[]) =>
      apiFetch<EventPlan>(`/event-plans/${planId}/days`, { method: "PATCH", body: JSON.stringify({ days }) }),
    onSuccess: invalidate,
  });
}

export function useResetEventPlan(planId: string) {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: () => apiFetch<EventPlan>(`/event-plans/${planId}/reset`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useSettleEventPlan(planId: string) {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: () => apiFetch<EventPlan>(`/event-plans/${planId}/settle`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useDeleteEventPlan() {
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: (planId: string) => apiFetch<null>(`/event-plans/${planId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function planDeltaForDate(deltas: EventPlanDelta[] | undefined, date: string): EventPlanDelta | null {
  return deltas?.find((d) => d.date === date) ?? null;
}
