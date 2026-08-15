import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { useSettings, useUpdateSettings } from "./settings";

export type StepDayState = "missing" | "complete" | "partial";
export interface StepDay {
  date: string;
  steps: number | null;
  state: StepDayState;
  updatedAt: string | null;
}

export interface StepHistory { today: string; days: StepDay[] }
export interface StepsToken {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
export interface StepsStatus {
  contract: string;
  supportedAppVersion: string;
  webhookPath: string;
  authorizationHeader: string;
  tokens: StepsToken[];
  sync: null | {
    lastSuccessfulSyncAt: string;
    lastPayloadTimestamp: string;
    lastAppVersion: string;
    lastRecordEndAt: string | null;
    lastRecordCount: number;
  };
}

export function useSteps(days = 3650) {
  return useQuery({
    queryKey: ["steps", days],
    queryFn: () => apiFetch<StepHistory>(`/steps?days=${days}`),
    // Sync happens in a separate Android app. Returning to MacroDaddy can be
    // well inside the global one-minute stale window, so freshness must not
    // suppress the refetch that makes an external sync visible.
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 60_000,
  });
}

export function useStepsStatus() {
  return useQuery({
    queryKey: ["steps", "status"],
    queryFn: () => apiFetch<StepsStatus>("/steps/status"),
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 60_000,
  });
}

export function useCreateStepsToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiFetch<{ id: string; name: string; token: string; tokenPrefix: string; createdAt: string }>(
      "/steps/tokens", { method: "POST", body: JSON.stringify({ name }) },
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["steps", "status"] }),
  });
}

export function useRevokeStepsToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/steps/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["steps", "status"] }),
  });
}

export function useStepGoal(): { goal: number; setGoal: (goal: number) => void; saving: boolean } {
  const settings = useSettings();
  const update = useUpdateSettings();
  const raw = settings.data?.stepGoal;
  const goal = typeof raw === "number" && Number.isInteger(raw) && raw >= 100 && raw <= 100_000 ? raw : 10_000;
  return { goal, setGoal: (next) => update.mutate({ stepGoal: next }), saving: update.isPending };
}
