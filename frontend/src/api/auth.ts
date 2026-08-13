import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface AuthUser {
  id: string;
  name: string;
  role: "admin" | "member";
}

export interface AuthStatus {
  authenticated: boolean;
  user?: AuthUser;
}

export function useAuthStatus() {
  return useQuery({
    queryKey: ["auth", "status"],
    queryFn: () => apiFetch<AuthStatus>("/auth/status"),
    // Authentication must never inherit the app-wide one-minute freshness
    // window. After an OIDC callback the browser returns to a brand-new app
    // runtime, but the persisted query cache can still contain the explicit
    // `authenticated: false` written by logout. Always confirm the cookie
    // with the server before deciding which screen to render.
    staleTime: 0,
    refetchOnMount: "always",
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

export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; password: string }) =>
      apiFetch<{ ok: true; user: AuthUser }>("/auth/signup", {
        method: "POST",
        body: JSON.stringify(input),
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
