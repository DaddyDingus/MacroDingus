import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Food } from "./types";
import { apiFetch } from "./client";

export function useFavorites() {
  return useQuery({
    queryKey: ["favorites"],
    queryFn: () => apiFetch<Food[]>("/favorites"),
  });
}

export function useAddFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (foodId: string) => apiFetch<unknown>("/favorites", { method: "POST", body: JSON.stringify({ foodId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });
}

export function useRemoveFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (foodId: string) => apiFetch<null>(`/favorites/${foodId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });
}
