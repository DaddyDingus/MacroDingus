import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface DailyAdjustment {
  id: string;
  userId: string;
  date: string;
  sourceDate: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  createdAt: string;
}

export function useAdjustment(date: string) {
  return useQuery({
    queryKey: ["adjustments", date],
    queryFn: () => apiFetch<DailyAdjustment | null>(`/adjustments/${date}`),
  });
}

export function useSaveAdjustment(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sourceDate: string; kcal: number; proteinG: number; carbsG: number; fatG: number }) =>
      apiFetch<DailyAdjustment>("/adjustments", {
        method: "POST",
        body: JSON.stringify({ date, ...input }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adjustments", date] }),
  });
}

export function useRemoveAdjustment(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<null>(`/adjustments/${date}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adjustments", date] }),
  });
}
