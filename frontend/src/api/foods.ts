import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { CreateFoodInput, DescribedMealItem, Food, LabelScanResult } from "./types";

export function useFoodSearch(query: string, debouncedRemoteQuery: string) {
  const normalizedQuery = query.trim();
  const normalizedRemoteQuery = debouncedRemoteQuery.trim();
  const remoteMatchesCurrentQuery = normalizedRemoteQuery.length > 0 && normalizedRemoteQuery === normalizedQuery;
  // SQLite-only: intentionally keyed straight off the live input rather than
  // the remote debounce, so a known household/AFCD food can render as soon as
  // the local network round-trip completes.
  const local = useQuery({
    queryKey: ["foods", "search", "local", normalizedQuery],
    queryFn: () => apiFetch<Food[]>(`/foods?q=${encodeURIComponent(normalizedQuery)}`),
    enabled: normalizedQuery.length >= 2,
  });
  // OFF-only: still waits for the typing pause. The query equality gate keeps
  // results for the previous word from appearing beneath fresh local results
  // during the 350ms before debouncedRemoteQuery catches up.
  const remote = useQuery({
    queryKey: ["foods", "search", "remote", normalizedRemoteQuery],
    queryFn: () => apiFetch<Food[]>(`/foods/remote?q=${encodeURIComponent(normalizedRemoteQuery)}`),
    enabled: remoteMatchesCurrentQuery && normalizedRemoteQuery.length >= 2,
  });

  const data = useMemo(() => {
    if (!local.data) return undefined;
    const combined: Food[] = [];
    const seen = new Set<string>();
    for (const food of [...local.data, ...(remoteMatchesCurrentQuery ? (remote.data ?? []) : [])]) {
      // A barcode-cached local row and its synthetic `off:<barcode>` result
      // are the same food. Name+brand catches the few OFF rows with no usable
      // barcode overlap while keeping the local version first.
      const key = food.barcode || `${food.name.trim().toLowerCase()}::${food.brand?.trim().toLowerCase() ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(food);
      if (combined.length === 20) break;
    }
    return combined;
  }, [local.data, remote.data, remoteMatchesCurrentQuery]);

  return {
    data,
    isPending: local.isPending,
    isLocalError: local.isError,
    retryLocal: () => local.refetch(),
    // Treat the debounce interval as part of the online search so an empty
    // local result never flashes "No foods found" for 300ms before OFF starts.
    isFetchingRemote: normalizedQuery.length >= 2 && (!remoteMatchesCurrentQuery || remote.isFetching),
  };
}

// Backs FoodDetailScreen's quantity prefill when logging a food fresh (not
// editing an already-logged entry, which seeds from that entry directly).
// `enabled` should be false while editing — there's nothing useful to do
// with a food's log history when the specific entry being edited already
// has its own known quantity.
export function useLastLoggedQuantity(foodId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["foods", foodId, "last-quantity"],
    queryFn: () =>
      apiFetch<{ quantityGrams: number | null; unitType: string | null; unitMeasureName: string | null }>(
        `/foods/${foodId}/last-quantity`
      ),
    enabled,
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

export function recordFoodSearchSelection(query: string, food: Food) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return;
  // Telemetry is deliberately best-effort and must never delay staging food.
  void apiFetch<void>("/foods/search-selection", {
    method: "POST",
    body: JSON.stringify({ query: trimmed, foodId: food.id, source: food.source }),
  }).catch(() => undefined);
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
