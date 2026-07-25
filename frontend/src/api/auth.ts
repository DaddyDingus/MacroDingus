import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface AuthUser {
  id: string;
  name: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user?: AuthUser;
}

export function useAuthStatus() {
  return useQuery({
    queryKey: ["auth", "status"],
    queryFn: () => apiFetch<AuthStatus>("/auth/status"),
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      apiFetch<{ ok: true; user: AuthUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    onSuccess: (data) =>
      qc.setQueryData<AuthStatus>(["auth", "status"], { authenticated: true, user: data.user }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: true }>("/auth/logout", { method: "POST" }),
    onSuccess: () => qc.setQueryData(["auth", "status"], { authenticated: false }),
  });
}
