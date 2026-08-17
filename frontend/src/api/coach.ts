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
  // Set once, on the account's first-ever goal creation — see App.tsx's
  // onboarding gate, which reads this instead of deriving "done" from live
  // weight/goal state.
  onboardingCompletedAt: string | null;
}

// What a check-in did to the active program's daily targets — averaged over
// the program's 7 weekday rows (see backend routes/coach.ts). Null when the
// check-in left targets alone: a manual program, one whose days were
// hand-edited, or no program at all.
export interface CheckinTargetChanges {
  calories: { from: number; to: number };
  proteinG: { from: number; to: number };
  carbsG: { from: number; to: number };
  fatG: { from: number; to: number };
  // How far below measured expenditure these targets sit (0.31 = 31%), and
  // whether that's past the advisory DEEP_DEFICIT_FRACTION. **Advisory only** —
  // the targets always deliver the goal's chosen rate, so this changes what
  // the screen says, never what it proposes.
  deficitFraction: number;
  deepDeficit: boolean;
  // What these targets actually imply in kg/week. Only differs from the goal's
  // own rate when the absolute calorie floor bound.
  effectiveRateKgPerWeek: number;
}

export interface CheckInResult {
  checkin: Checkin;
  usedAdaptiveTdee: boolean;
  targetChanges: CheckinTargetChanges | null;
}

// What a check-in *would* do, from POST /api/checkins/preview — nothing is
// written until you accept. Carries the same numbers as CheckInResult minus
// the fields that only exist once a checkins row does (id/createdAt/narrative),
// so one renderer can draw either.
export interface CheckInPreview {
  preview: { date: string; tdee: number; trendWeightKg: number; tdeeFluxKcal: number | null };
  usedAdaptiveTdee: boolean;
  targetChanges: CheckinTargetChanges | null;
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
  // The backend's household-local calendar date. Due-state UI compares
  // against this exact value so it cannot disagree with POST /checkins.
  currentDate: string;
  profile: Profile | null;
  latestCheckin: Checkin | null;
  trendWeightKg: number | null;
  bodyFatPercent: number | null;
  expenditureCoverage: {
    ready: boolean;
    nutritionDays: number;
    nutritionDaysRequired: number;
    weighIns: number;
    weighInsRequired: number;
    weightSpanDays: number;
    latestWeightDate: string | null;
  };
  daysSinceCheckin: number | null;
  // Null until a first check-in exists — the weekly restriction only kicks
  // in after that (see backend/src/lib/checkinSchedule.ts).
  nextCheckinDueDate: string | null;
  // The user chose to ignore the currently pending check-in. Reminder
  // surfaces (Dashboard banner, bottom-nav dot) must honour this; the
  // Strategy screen deliberately does not — checking in stays available
  // there, ignored or not. Re-arms itself once a check-in starts a new cycle.
  checkinIgnored: boolean;
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
    // v2 adds household-calendar dates to the active goal/program.
    queryKey: ["coach", "status", "v2"],
    queryFn: () => apiFetch<CoachStatus>("/coach/status"),
  });
}

// Backs OnboardingFlow's "Skip for now" on the weight step — finishes
// onboarding without requiring a goal (see backend routes/coach.ts).
export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ profile: Profile }>("/profile/complete-onboarding", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach"] }),
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

// Costs nothing to abandon: no checkins row, no target regeneration, no
// narrative call. Declining is POST /api/checkins/ignore (useIgnoreCheckin),
// exactly the same silence-this-cycle mechanism the Dashboard/Strategy Ignore
// buttons use — there's no third "declined" state to store.
export function usePreviewCheckIn() {
  return useMutation({
    mutationFn: () => apiFetch<CheckInPreview>("/checkins/preview", { method: "POST" }),
  });
}

export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<CheckInResult>("/checkins", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coach"] });
      qc.invalidateQueries({ queryKey: ["programs"] }); // a coached, non-custom program's targets may have just refreshed
    },
  });
}

// Dismisses the current check-in's reminders without checking in — see
// CoachStatus.checkinIgnored.
export function useIgnoreCheckin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ignored: boolean }>("/checkins/ignore", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coach"] }),
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
