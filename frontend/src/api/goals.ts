import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { GoalType } from "./coach";

export interface Goal {
  id: string;
  goalType: GoalType;
  goalWeightKg: number | null;
  targetRateKgPerWeek: number;
  startedAt: string;
  startedDate: string;
  startWeightKg: number | null;
  endedAt: string | null;
  endedDate: string | null;
  createdAt: string;
}

export interface GoalInput {
  goalType: GoalType;
  goalWeightKg: number | null;
  targetRateKgPerWeek: number;
}

export interface GoalEditInput {
  goalWeightKg: number | null;
  targetRateKgPerWeek: number;
}

export function useGoals() {
  return useQuery({
    // v2 includes backend-resolved household startedDate/endedDate fields.
    queryKey: ["goals", "v2"],
    queryFn: () => apiFetch<Goal[]>("/goals"),
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GoalInput) => apiFetch<Goal>("/goals", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["coach"] });
      qc.invalidateQueries({ queryKey: ["programs"] });
    },
  });
}

export function useEditGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: GoalEditInput & { id: string }) =>
      apiFetch<Goal>(`/goals/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["coach"] });
    },
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<null>(`/goals/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["coach"] });
      qc.invalidateQueries({ queryKey: ["programs"] }); // deleting a goal cascades to its program(s) server-side
    },
  });
}

export function useReopenGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<Goal>(`/goals/${id}/reopen`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["coach"] });
      qc.invalidateQueries({ queryKey: ["programs"] });
    },
  });
}
