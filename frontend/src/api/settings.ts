import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { useAuthStatus } from "./auth";

// A loose bag of independent frontend preferences (theme, units, dashboard
// shortcuts/colors, dashboard layout) — see backend/src/routes/settings.ts
// for why this is one untyped JSON blob rather than a strict shape.
export type SettingsBlob = Record<string, unknown>;

export function useSettings() {
  const auth = useAuthStatus();
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<SettingsBlob>("/settings"),
    enabled: !!auth.data?.authenticated,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsBlob) =>
      apiFetch<SettingsBlob>("/settings", { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export interface AiSettingsStatus {
  configured: boolean;
  source: "account" | "environment" | null;
}

export function useAiSettings() {
  const auth = useAuthStatus();
  return useQuery({
    queryKey: ["settings", "ai"],
    queryFn: () => apiFetch<AiSettingsStatus>("/settings/ai"),
    enabled: !!auth.data?.authenticated,
  });
}

export function useSaveAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) =>
      apiFetch<AiSettingsStatus>("/settings/ai", { method: "PUT", body: JSON.stringify({ apiKey }) }),
    onSuccess: (data) => qc.setQueryData(["settings", "ai"], data),
  });
}

export function useRemoveAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>("/settings/ai", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "ai"] }),
  });
}
