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
