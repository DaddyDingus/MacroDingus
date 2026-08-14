import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { CreateRecipeInput, Food, ImportedRecipeResult } from "./types";

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
  cookwareCalculation: {
    cookwareId: string | null;
    cookwareName: string;
    tareWeightGrams: number;
    scaleWeightGrams: number;
  } | null;
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipes"] });
      qc.invalidateQueries({ queryKey: ["foods"] });
    },
  });
}

export function useUpdateRecipe(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRecipeInput) =>
      apiFetch<RecipeDetail>(`/recipes/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (updated) => {
      // The edit form owns local state initialized from this detail query.
      // Put the PATCH response into the cache immediately so reopening it
      // cannot initialize from the pre-edit persisted response while the
      // invalidation refetch is still in flight.
      qc.setQueryData(["recipes", id], updated);
      qc.invalidateQueries({ queryKey: ["recipes"] });
      qc.invalidateQueries({ queryKey: ["foods"] });
      // Recipe foods are materialized rows whose nutrition is read live by
      // existing logs, so an edit can change historical totals and TDEE.
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "logs" });
      qc.invalidateQueries({ queryKey: ["coach"] });
    },
  });
}

// Unmatched ingredients create real foods rows server-side
// (source: 'ai_estimate', same as useDescribeMeal) even though the recipe
// itself isn't saved until the user actually hits "Save recipe" on the
// pre-filled form — invalidate the same way any other food-creating
// mutation does so those rows are visible wherever `foods` is queried.
export function useImportRecipeUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => apiFetch<ImportedRecipeResult>("/recipes/import-url", { method: "POST", body: JSON.stringify({ url }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["foods"] }),
  });
}

// Same ImportedRecipeResult shape/contract as useImportRecipeUrl — a photo
// of a handwritten or printed ingredient list in, a pre-filled draft out.
// Multipart like useScanNutritionLabel, not JSON.
export function useImportRecipePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { file: File | Blob; description?: string }) => {
      const form = new FormData();
      if (params.description) {
        form.append("description", params.description);
      }
      form.append("file", params.file, "recipe.jpg");
      return apiFetch<ImportedRecipeResult>("/recipes/import-photo", { method: "POST", body: form });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["foods"] }),
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<null>(`/recipes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipes"] });
      qc.invalidateQueries({ queryKey: ["foods"] });
    },
  });
}
