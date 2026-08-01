import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { Goal } from "./goals";
import type { Program } from "./programs";

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type GoalType = "cut" | "bulk" | "maintain";

// Body-stat fields only — goal/program fields moved to goals.ts/programs.ts
// (see backend/src/db/schema.ts's Phase 1/Phase 2 migration notes).
export interface Profile {
  userId: string;
  sex: "male" | "female";
  birthYear: number;
  heightCm: number;
  activityLevel: ActivityLevel;
  checkInDayOfWeek: number | null; // 0=Sunday..6=Saturday, matches JS Date.getDay()
  weeklyExerciseHours: number | null;
  createdAt: string;
  updatedAt: string;
}

// A check-in is purely a TDEE-estimate snapshot now — targets moved to
// program_days (see lib/programTargets.ts's targetsForDate(), which
// replaces every place that used to read .targetCalories/etc. off a Checkin).
export interface Checkin {
  id: string;
  date: string;
  tdee: number;
  trendWeightKg: number;
  usedAdaptiveTdee: boolean | null;
  tdeeFluxKcal: number | null;
  // Short, deliberately unencouraging factual summary of the period since
  // the previous check-in (see backend/src/engine/checkinNarrative.ts) —
  // null when no API key was configured at check-in time, generation
  // failed, or this check-in predates the feature.
  narrative: string | null;
  createdAt: string;
}

export interface CoachStatus {
  profile: Profile | null;
  latestCheckin: Checkin | null;
  trendWeightKg: number | null;
  bodyFatPercent: number | null;
  daysSinceCheckin: number | null;
  // Null until a first check-in exists — the weekly restriction only kicks
  // in after that (see backend/src/lib/checkinSchedule.ts).
  nextCheckinDueDate: string | null;
  activeGoal: Goal | null;
  activeProgram: (Program & { days: Program["days"] }) | null;
}

export interface ProfileInput {
  sex: "male" | "female";
  birthYear: number;
  heightCm: number;
  activityLevel: ActivityLevel;
  checkInDayOfWeek: number | null;
  weeklyExerciseHours: number | null;
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
      apiFetch<{ profile: Profile }>("/profile", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach"] }),
  });
}

export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ checkin: Checkin; usedAdaptiveTdee: boolean }>("/checkins", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coach"] });
      qc.invalidateQueries({ queryKey: ["programs"] }); // a coached, non-custom program's targets may have just refreshed
    },
  });
}

export function useCheckinHistory() {
  return useQuery({
    queryKey: ["coach", "checkins"],
    queryFn: () => apiFetch<Checkin[]>("/checkins"),
  });
}

// A per-day TDEE/flux backfill (see GET /api/coach/expenditure-daily) — one
// point per day where the adaptive engine had enough data to produce a real
// estimate, gaps everywhere else. Distinct from Checkin: this is never
// persisted and never drives actual targets, it only feeds the Expenditure
// chart's Flux Range band and the daily history list.
export interface DailyExpenditurePoint {
  date: string;
  tdee: number;
  fluxKcal: number;
}

export function useExpenditureDailySeries(days: number) {
  return useQuery({
    queryKey: ["coach", "expenditure-daily", days],
    queryFn: () => apiFetch<DailyExpenditurePoint[]>(`/coach/expenditure-daily?days=${days}`),
  });
}
