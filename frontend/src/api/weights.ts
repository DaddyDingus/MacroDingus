import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface WeighIn {
  id: string;
  date: string;
  weightKg: number;
  createdAt: string;
}

export interface TrendPoint {
  date: string;
  weightKg: number;
  trendKg: number;
}

export function useWeights(days: number) {
  return useQuery({
    queryKey: ["weights", days],
    queryFn: () => apiFetch<WeighIn[]>(`/weights?days=${days}`),
  });
}

export function useWeightTrend(days: number) {
  return useQuery({
    queryKey: ["weights", "trend", days],
    queryFn: () => apiFetch<TrendPoint[]>(`/weights/trend?days=${days}`),
  });
}

// Both mutations below also invalidate ["coach"]: /coach/status recomputes
// trend weight live from the full weight history on every request (see
// engine/trendWeight.ts), so a new or deleted weigh-in changes what that
// endpoint would return right now — but its cached result doesn't know that
// on its own. Without this, tiles reading useCoachStatus() (Goal progress,
// Expenditure) kept showing the pre-weigh-in trend until something unrelated
// happened to refetch it (e.g. navigating away and back).
export function useLogWeight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; weightKg: number }) =>
      apiFetch<WeighIn>("/weights", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weights"] });
      qc.invalidateQueries({ queryKey: ["coach"] });
    },
  });
}

export function useDeleteWeight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<null>(`/weights/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weights"] });
      qc.invalidateQueries({ queryKey: ["coach"] });
    },
  });
}
