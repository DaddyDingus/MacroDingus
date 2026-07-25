import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface Photo {
  id: string;
  date: string;
  filename: string;
  createdAt: string;
}

export function usePhotos() {
  return useQuery({
    queryKey: ["photos"],
    queryFn: () => apiFetch<Photo[]>("/photos"),
  });
}

export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; date: string }) => {
      const form = new FormData();
      form.append("date", input.date);
      form.append("file", input.file);
      return apiFetch<Photo>("/photos", { method: "POST", body: form });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}

export function useDeletePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<null>(`/photos/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photos"] }),
  });
}
