import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const BODY_PARTS = [
  "Neck",
  "Shoulders",
  "Chest",
  "Left Bicep",
  "Right Bicep",
  "Waist",
  "Hips",
  "Left Thigh",
  "Right Thigh",
  "Left Calf",
  "Right Calf",
] as const;

export type BodyPart = (typeof BODY_PARTS)[number];

export interface Measurement {
  id: string;
  date: string;
  part: string;
  valueCm: number;
  createdAt: string;
}

export function useMeasurements() {
  return useQuery({
    queryKey: ["measurements"],
    queryFn: () => apiFetch<Measurement[]>("/measurements"),
  });
}

export function useSaveMeasurements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; measurements: { part: string; valueCm: number }[] }) =>
      apiFetch<Measurement[]>("/measurements", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["measurements"] }),
  });
}

export function useDeleteMeasurementsForDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => apiFetch<null>(`/measurements/date/${date}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["measurements"] }),
  });
}
