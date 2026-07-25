import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { CreateFoodInput, Food } from "./types";

export function useFoodSearch(query: string) {
  return useQuery({
    queryKey: ["foods", "search", query],
    queryFn: () => apiFetch<Food[]>(`/foods?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length > 0,
  });
}

export function useCreateFood() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFoodInput) =>
      apiFetch<Food>("/foods", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["foods"] }),
  });
}
