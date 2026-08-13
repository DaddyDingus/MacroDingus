import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { AuthStatus, AuthUser } from "./auth";

export function useRenameAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ ok: true; user: AuthUser }>("/account/name", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: (data) =>
      qc.setQueryData<AuthStatus>(["auth", "status"], { authenticated: true, user: data.user }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      apiFetch<{ ok: true }>("/account/password", { method: "PATCH", body: JSON.stringify(input) }),
  });
}

export function useExportAccountData() {
  return useMutation({
    mutationFn: () => apiFetch<Record<string, unknown>>("/account/export"),
  });
}

export interface ServerBackupStatus {
  enabled: boolean;
  lastBackupAt: string | null;
  backupCount: number;
  automaticEveryHours: number;
}

export function useServerBackupStatus() {
  return useQuery({
    queryKey: ["account", "backup-status"],
    queryFn: () => apiFetch<ServerBackupStatus>("/account/backup-status"),
  });
}

export function useRunServerBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<ServerBackupStatus>("/account/backup", { method: "POST" }),
    onSuccess: (data) => qc.setQueryData(["account", "backup-status"], data),
  });
}

export function useImportAccountData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      let payload: unknown;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        throw new Error("That file isn't valid JSON");
      }
      return apiFetch<{ ok: true; importedAt: string }>("/account/import", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

// Clears this account's own data (weights, logs, check-ins, goals,
// programs, photos, profile) — see backend/src/routes/account.ts for exact
// scope (shared foods are deliberately untouched). No scoped
// invalidation list here on purpose: this touches nearly every domain in
// the app at once, so a blanket invalidate is simpler and more thorough
// than trying to enumerate every affected query key. Once the profile is
// gone, App.tsx's onboarding gate picks the account up as fresh on its own.
export function useClearAccountData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<null>("/account/data", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries(),
  });
}
