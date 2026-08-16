import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface AdminUser {
  id: string;
  name: string;
  role: "admin" | "member";
  createdAt: string;
  lastSeenAt: string | null;
  disabledAt: string | null;
  authentikLinked: boolean;
  isSelf: boolean;
  logCount: number;
  lastLoggedDate: string | null;
  weightCount: number;
  lastWeightDate: string | null;
  photoCount: number;
}

export interface AdminUsersResponse {
  authentikUsersUrl: string | null;
  users: AdminUser[];
}

export function useAdminUsers(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<AdminUsersResponse>("/admin/users"),
    // Members get a 403 here by design; there is nothing to retry into.
    enabled,
    retry: false,
  });
}

export function useSetAccountAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      apiFetch<{ ok: true }>(`/admin/users/${id}/access`, {
        method: "PATCH",
        body: JSON.stringify({ disabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<null>(`/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}
