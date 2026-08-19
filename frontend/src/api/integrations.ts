import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface IntegrationToken {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function useIntegrationTokens() {
  return useQuery({
    queryKey: ["integrations", "tokens"],
    queryFn: () => apiFetch<{ tokens: IntegrationToken[] }>("/integrations/tokens"),
    refetchOnMount: "always",
  });
}

export function useCreateIntegrationToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiFetch<{ id: string; name: string; token: string; createdAt: string }>(
      "/integrations/tokens", { method: "POST", body: JSON.stringify({ name }) },
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", "tokens"] }),
  });
}

export function useRevokeIntegrationToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/integrations/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations", "tokens"] }),
  });
}
