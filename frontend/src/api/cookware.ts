import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface CookwareItem {
  id: string;
  name: string;
  weightGrams: number;
  createdAt: string;
  updatedAt: string;
}

export interface CookwareInput {
  name: string;
  weightGrams: number;
}

export function useCookware() {
  return useQuery({
    queryKey: ["cookware"],
    queryFn: () => apiFetch<CookwareItem[]>("/cookware"),
  });
}

export function useCreateCookware() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CookwareInput) =>
      apiFetch<CookwareItem>("/cookware", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cookware"] }),
  });
}

export function useUpdateCookware() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: CookwareInput & { id: string }) =>
      apiFetch<CookwareItem>(`/cookware/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cookware"] }),
  });
}

export function useDeleteCookware() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/cookware/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cookware"] }),
  });
}
