import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { CreateRecipeInput, Food } from "./types";

export interface RecipeSummary {
  id: string;
  name: string;
  servings: number;
  totalWeightGrams: number;
  food: Food;
}

export interface RecipeDetail {
  id: string;
  name: string;
  servings: number;
  totalWeightGrams: number;
  food: Food;
  ingredients: { foodId: string; food: Food; quantityGrams: number }[];
}

export function useRecipes() {
  return useQuery({
    queryKey: ["recipes"],
    queryFn: () => apiFetch<RecipeSummary[]>("/recipes"),
  });
}

export function useRecipeDetail(id: string | null) {
  return useQuery({
    queryKey: ["recipes", id],
    queryFn: () => apiFetch<RecipeDetail>(`/recipes/${id}`),
    enabled: !!id,
  });
}

export function useCreateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRecipeInput) =>
      apiFetch<Food>("/recipes", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["foods"] }),
  });
}

export function useUpdateRecipe(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRecipeInput) =>
      apiFetch<RecipeDetail>(`/recipes/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipes"] });
      qc.invalidateQueries({ queryKey: ["foods"] });
    },
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<null>(`/recipes/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipes"] }),
  });
}
