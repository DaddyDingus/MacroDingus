import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type PhotoPose = "front" | "side" | "back";

export interface Photo {
  id: string;
  date: string;
  filename: string;
  pose: PhotoPose | null;
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
    mutationFn: (input: { file: File | Blob; date: string; pose?: PhotoPose }) => {
      const form = new FormData();
      form.append("date", input.date);
      if (input.pose) form.append("pose", input.pose);
      form.append("file", input.file, "photo.jpg");
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

export interface PhotoCompareResult {
  hasVisibleChange: boolean;
  observations: string[];
}

// Ad hoc — not cached by TanStack Query as a persisted result, just a plain
// mutation fired on tap. See backend/src/engine/photoCompare.ts for why the
// prompt withholds weight/scale numbers from the model.
export function useComparePhotos() {
  return useMutation({
    mutationFn: (input: { photoIdA: string; photoIdB: string }) =>
      apiFetch<PhotoCompareResult>("/photos/compare", { method: "POST", body: JSON.stringify(input) }),
  });
}
