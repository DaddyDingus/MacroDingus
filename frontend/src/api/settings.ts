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

export const AI_PROVIDERS = ["openai", "anthropic", "gemini"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export type AiAccessPolicy = "server" | "bring_your_own_key" | "disabled";
export type CredentialValidationStatus = "unknown" | "valid" | "invalid";

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
};

export const AI_PROVIDER_KEY_URLS: Record<AiProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  gemini: "https://aistudio.google.com/app/apikey",
};

export interface AiSettingsStatus {
  policy: AiAccessPolicy;
  enabled: boolean;
  providers: {
    provider: AiProvider;
    configured: boolean;
    validationStatus?: CredentialValidationStatus;
  }[];
}

export function useAiSettings() {
  const auth = useAuthStatus();
  return useQuery({
    queryKey: ["settings", "ai"],
    queryFn: () => apiFetch<AiSettingsStatus>("/settings/ai"),
    enabled: !!auth.data?.authenticated,
    refetchOnMount: "always",
  });
}

function invalidateAiSettings(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: ["settings", "ai"] });
}

export function useSaveAiKey() {
  const qc = useQueryClient();
  return useMutation({
    // Credential text exists only while this request is in flight. The UI
    // resets the observer on settlement, and zero GC removes its cache entry.
    gcTime: 0,
    mutationFn: ({ provider, apiKey }: { provider: AiProvider; apiKey: string }) =>
      apiFetch<{ ok: true }>(`/settings/ai/providers/${provider}`, { method: "PUT", body: JSON.stringify({ apiKey }) }),
    onSuccess: () => invalidateAiSettings(qc),
  });
}

export function useTestAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: AiProvider) =>
      apiFetch<{ ok: true }>(`/settings/ai/providers/${provider}/test`, { method: "POST" }),
    onSuccess: () => invalidateAiSettings(qc),
  });
}

export function useRemoveAiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: AiProvider) => apiFetch<{ ok: true }>(`/settings/ai/providers/${provider}`, { method: "DELETE" }),
    onSuccess: () => invalidateAiSettings(qc),
  });
}
