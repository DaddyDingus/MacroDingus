import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { AuthStatus } from "./auth";

export function useRenameAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ ok: true; user: { id: string; name: string } }>("/account/name", {
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

// Clears this account's own data (weights, logs, check-ins, goals,
// programs, photos, profile) — see backend/src/routes/account.ts for exact
// scope (shared foods/recipes are deliberately untouched). No scoped
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
