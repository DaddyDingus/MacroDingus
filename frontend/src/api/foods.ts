import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { CreateFoodInput, DescribedMealItem, Food, LabelScanResult } from "./types";

export function useFoodSearch(query: string) {
  return useQuery({
    queryKey: ["foods", "search", query],
    queryFn: () => apiFetch<Food[]>(`/foods?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length > 0,
  });
}

// Backs the Add Food sheet's Library tab "Foods" view — every manually
// created custom food (not an OpenFoodFacts cache or a recipe's own
// materialized food), shared across the household like the rest of `foods`.
export function useCustomFoods() {
  return useQuery({
    queryKey: ["foods", "source", "custom"],
    queryFn: () => apiFetch<Food[]>("/foods?source=custom&limit=50"),
  });
}

export function useBarcodeLookup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (barcode: string) => apiFetch<Food>(`/foods/barcode/${encodeURIComponent(barcode)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["foods"] }),
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

// Same FormData-upload shape as useUploadPhoto — apiFetch already skips the
// JSON Content-Type header for a FormData body (see client.ts), so no extra
// handling is needed here for the multipart boundary.
export function useScanNutritionLabel() {
  return useMutation({
    mutationFn: (file: File | Blob) => {
      const form = new FormData();
      form.append("file", file, "label.jpg");
      return apiFetch<LabelScanResult>("/foods/scan-label", { method: "POST", body: form });
    },
  });
}

// text and/or photo — the route requires at least one, but either alone is a
// valid call (photo-only "just guess from the picture", text-only the
// original typed-description flow). Always FormData now, even for a
// text-only call, so the backend has one multipart parsing path rather than
// two (JSON body vs. multipart) for what's really the same endpoint.
export function useDescribeMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ text, photo }: { text?: string; photo?: File | Blob }) => {
      const form = new FormData();
      if (text) form.append("text", text);
      if (photo) form.append("photo", photo, "meal.jpg");
      return apiFetch<DescribedMealItem[]>("/foods/describe-meal", { method: "POST", body: form });
    },
    // Unmatched items create real foods rows server-side (source: 'ai_estimate') —
    // invalidate the same way any other food-creating mutation does so Library/search pick them up.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["foods"] }),
  });
}

export function useDeleteFood() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<null>(`/foods/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["foods"] }),
  });
}
