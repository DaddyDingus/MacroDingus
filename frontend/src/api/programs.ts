import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type ProgramStyle = "coached" | "manual";
export type DietType = "balanced" | "low_fat" | "low_carb" | "keto";
export type ProteinLevel = "low" | "moderate" | "high" | "extra_high" | "custom";
export type ProteinBasis = "total" | "lean";
export type DistributionMode = "even" | "shifted" | "custom";

export interface ProgramDay {
  id: string;
  programId: string;
  dayOfWeek: number; // 0=Sunday..6=Saturday, matches JS Date.getDay()
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
}

export interface Program {
  id: string;
  userId: string;
  goalId: string;
  style: ProgramStyle;
  dietType: DietType | null;
  calorieFloorKcal: number | null;
  proteinLevel: ProteinLevel | null;
  proteinPerKgUsed: number | null;
  proteinBasis: ProteinBasis;
  initialTdeeOverrideKcal: number | null;
  distributionMode: DistributionMode;
  shiftedHighDays: number[] | null; // 0=Sunday..6=Saturday — only meaningful when distributionMode is 'shifted'
  startedAt: string;
  startedDate: string;
  endedAt: string | null;
  endedDate: string | null;
  createdAt: string;
  days: ProgramDay[];
}

export interface ProgramBreakdown {
  tdee: number;
  usedAdaptiveTdee: boolean;
  tdeeFluxKcal: number | null;
  trendWeightKg: number;
  flatTargetCalories: number;
  proteinPerKgUsed: number;
  fatPercentUsed: number;
  proteinBasisUsed: ProteinBasis;
  leanBodyMassKg: number | null;
  usedInitialOverride: boolean;
}

export interface ProgramDayValues {
  dayOfWeek: number;
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
}

export interface CreateCoachedProgramInput {
  goalId: string;
  style: "coached";
  dietType: DietType;
  calorieFloorKcal: number;
  proteinLevel: ProteinLevel;
  customProteinPerKg?: number; // required by the backend when proteinLevel is 'custom'
  startingCalories?: number; // optional "starting Calories" from the Calories step
  distributionMode: "even" | "shifted";
  shiftedHighDays?: number[]; // required by the backend when distributionMode is 'shifted'
  proteinBasis: ProteinBasis;
}

export interface CreateManualProgramInput {
  goalId: string;
  style: "manual";
  days: ProgramDayValues[]; // exactly 7
}

export type CreateProgramInput = CreateCoachedProgramInput | CreateManualProgramInput;

export function usePrograms() {
  return useQuery({
    // v2 includes backend-resolved household startedDate/endedDate fields.
    queryKey: ["programs", "v2"],
    queryFn: () => apiFetch<Program[]>("/programs"),
  });
}

export function useCreateProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProgramInput) =>
      apiFetch<{ program: Program; breakdown: ProgramBreakdown | null }>("/programs", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["coach"] });
    },
  });
}

export function useUpdateProgramDays() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, days }: { id: string; days: ProgramDayValues[] }) =>
      apiFetch<Program>(`/programs/${id}/days`, { method: "PATCH", body: JSON.stringify({ days }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["coach"] });
    },
  });
}

export function useRegenerateProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ program: Program; breakdown: ProgramBreakdown }>(`/programs/${id}/regenerate`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["coach"] });
    },
  });
}
