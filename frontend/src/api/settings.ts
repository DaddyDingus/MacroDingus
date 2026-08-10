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

export type AiProvider = "anthropic" | "openai" | "gemini";
export type AiTaskId = "labelScan" | "mealDescription" | "recipeImport" | "recipePhotoImport" | "photoComparison" | "checkinNarrative";

export interface AiProviderStatus {
  label: string;
  keyPlaceholder: string;
  keyUrl: string;
  models: string[];
  discoveredModels?: string[];
  modelCatalogSource?: "live" | "cache" | "fallback";
  modelsRefreshedAt?: string | null;
  configured: boolean;
  source: "account" | "environment" | null;
}

export interface AiTaskStatus {
  id: AiTaskId;
  label: string;
  description: string;
  recommendedModels: Record<AiProvider, string>;
  provider: AiProvider;
  model: string;
  configured: boolean;
  // Null means "no fallback configured" — never defaulted the way
  // provider/model above are, so "None" round-trips cleanly in the UI.
  fallbackProvider: AiProvider | null;
  fallbackModel: string | null;
  fallbackConfigured: boolean;
}

export interface AiSettingsStatus {
  providers: Record<AiProvider, AiProviderStatus>;
  tasks: AiTaskStatus[];
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
    mutationFn: ({ provider, apiKey }: { provider: AiProvider; apiKey: string }) =>
      apiFetch<AiSettingsStatus>(`/settings/ai/providers/${provider}`, { method: "PUT", body: JSON.stringify({ apiKey }) }),
    onSuccess: (data) => qc.setQueryData(["settings", "ai"], data),
  });
}

export function useRemoveAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: AiProvider) => apiFetch<void>(`/settings/ai/providers/${provider}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "ai"] }),
  });
}

export function useSaveAiTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ task, provider, model }: { task: AiTaskId; provider: AiProvider; model: string }) =>
      apiFetch<AiSettingsStatus>(`/settings/ai/tasks/${task}`, {
        method: "PUT",
        body: JSON.stringify({ provider, model }),
      }),
    onSuccess: (data) => qc.setQueryData(["settings", "ai"], data),
  });
}

export function useSaveAiTaskFallback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ task, provider, model }: { task: AiTaskId; provider: AiProvider; model: string }) =>
      apiFetch<AiSettingsStatus>(`/settings/ai/tasks/${task}/fallback`, {
        method: "PUT",
        body: JSON.stringify({ provider, model }),
      }),
    onSuccess: (data) => qc.setQueryData(["settings", "ai"], data),
  });
}

export function useClearAiTaskFallback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (task: AiTaskId) =>
      apiFetch<AiSettingsStatus>(`/settings/ai/tasks/${task}/fallback`, { method: "DELETE" }),
    onSuccess: (data) => qc.setQueryData(["settings", "ai"], data),
  });
}
