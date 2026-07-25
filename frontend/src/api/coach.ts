import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type GoalType = "cut" | "bulk" | "maintain";

export interface Profile {
  userId: string;
  sex: "male" | "female";
  birthYear: number;
  heightCm: number;
  activityLevel: ActivityLevel;
  goalType: GoalType;
  targetRateKgPerWeek: number;
  createdAt: string;
  updatedAt: string;
}

export interface Checkin {
  id: string;
  date: string;
  tdee: number;
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  trendWeightKg: number;
  createdAt: string;
}

export interface CoachStatus {
  profile: Profile | null;
  latestCheckin: Checkin | null;
  trendWeightKg: number | null;
  daysSinceCheckin: number | null;
}

export interface ProfileInput {
  sex: "male" | "female";
  birthYear: number;
  heightCm: number;
  activityLevel: ActivityLevel;
  goalType: GoalType;
  targetRateKgPerWeek: number;
}

export function useCoachStatus() {
  return useQuery({
    queryKey: ["coach", "status"],
    queryFn: () => apiFetch<CoachStatus>("/coach/status"),
  });
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileInput) =>
      apiFetch<{ profile: Profile; checkin?: Checkin; error?: string }>("/profile", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach"] }),
  });
}

export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ checkin: Checkin; usedAdaptiveTdee: boolean }>("/checkins", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach"] }),
  });
}
