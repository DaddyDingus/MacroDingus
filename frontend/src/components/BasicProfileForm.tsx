import { useState } from "react";
import type { ActivityLevel } from "../api/coach";

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string; description: string }[] = [
  { value: "sedentary", label: "Sedentary", description: "Desk job, little movement" },
  { value: "light", label: "Lightly active", description: "Light walking, on your feet sometimes" },
  { value: "moderate", label: "Moderately active", description: "Active job or regular daily movement" },
  { value: "active", label: "Active", description: "Physical job or very active lifestyle" },
  { value: "very_active", label: "Very active", description: "Hard physical labour all day" },
];

// The sex/age/height/activity/exercise form CoachScreen shows as a fallback
// when a profile is missing, OnboardingFlow shows as its own step, and More
// shows (via EditBodyProfileSheet) for editing an already-set-up profile —
// same fields, same validation, deliberately no header/wrapper of its own so
// each caller can supply the chrome that fits its context. `initial` seeds
// the fields for the edit case; omitted it falls back to the same onboarding
// defaults as before. `initial.checkInDayOfWeek` isn't a field this form
// collects (that's ChangeCheckInDaySheet's job) but it's round-tripped
// through onSave unchanged rather than hardcoded to null, so editing an
// already-configured profile can't silently clear a check-in day that was
// already chosen.
export default function BasicProfileForm({
  saving,
  ctaLabel = "Continue",
  initial,
  onSave,
}: {
  saving: boolean;
  ctaLabel?: string;
  initial?: {
    sex: "male" | "female";
    birthYear: number;
    heightCm: number;
    activityLevel: ActivityLevel;
    weeklyExerciseHours: number | null;
    checkInDayOfWeek?: number | null;
  };
  onSave: (input: { sex: "male" | "female"; birthYear: number; heightCm: number; activityLevel: ActivityLevel; checkInDayOfWeek: number | null; weeklyExerciseHours: number | null }) => void;
}) {
  const [sex, setSex] = useState<"male" | "female">(initial?.sex ?? "male");
  const [birthYear, setBirthYear] = useState(String(initial?.birthYear ?? 1990));
  const [heightCm, setHeightCm] = useState(String(initial?.heightCm ?? 175));
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>(initial?.activityLevel ?? "moderate");
  const [exerciseHours, setExerciseHours] = useState(initial?.weeklyExerciseHours != null ? String(initial.weeklyExerciseHours) : "");

  const canSave = Number(birthYear) > 1900 && Number(heightCm) > 0;
  const parsedExerciseHours = exerciseHours.trim() === "" ? null : Math.max(0, Number(exerciseHours));
  const checkInDayOfWeek = initial?.checkInDayOfWeek ?? null;

  // Enter submits via onKeyDown on the number fields below, not a wrapping
  // <form> — a <form> element turned out to be what triggers Chrome's full
  // autofill accessory strip (passwords/payment/addresses icons) on Android,
  // regardless of autocomplete="off". See AddFoodSheet's QuickAddTab for the
  // fuller story.
  function submitOnEnter(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || !canSave || saving) return;
    onSave({ sex, birthYear: Number(birthYear), heightCm: Number(heightCm), activityLevel, checkInDayOfWeek, weeklyExerciseHours: parsedExerciseHours });
  }

  return (
    <div className="space-y-4">
      <div className="flex rounded-md border border-line overflow-hidden">
        {(["male", "female"] as const).map((s) => (
          <button key={s} type="button" onClick={() => setSex(s)} className={`flex-1 py-2.5 text-sm capitalize ${sex === s ? "bg-surface-raised text-accent" : "text-muted"}`}>
            {s}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted">Birth year</label>
          <input type="search" inputMode="numeric" autoComplete="off" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} onKeyDown={submitOnEnter} className="w-full border border-line rounded-md px-3 py-2.5 bg-transparent mt-1 focus-within:border-accent focus:outline-none" />
        </div>
        <div>
          <label className="text-xs text-muted">Height (cm)</label>
          <input type="search" inputMode="decimal" autoComplete="off" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} onKeyDown={submitOnEnter} className="w-full border border-line rounded-md px-3 py-2.5 bg-transparent mt-1 focus-within:border-accent focus:outline-none" />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted">Daily activity level</label>
        <p className="text-[11px] text-muted/70 mt-0.5 mb-2">Don't count workouts here — just your general lifestyle.</p>
        <div className="border border-line rounded-md overflow-hidden">
          {ACTIVITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setActivityLevel(opt.value)}
              className={`w-full text-left px-4 py-2.5 border-b border-line/60 last:border-b-0 text-sm ${activityLevel === opt.value ? "bg-surface-raised text-accent" : ""}`}
            >
              <span className="block">{opt.label}</span>
              <span className="block text-[11px] text-muted mt-0.5">{opt.description}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted">High-intensity exercise (hours/week)</label>
        <p className="text-[11px] text-muted/70 mt-0.5 mb-1">Hard training sessions only — weightlifting, running, HIIT, etc. Leave blank if none.</p>
        <input
          type="search"
          inputMode="decimal"
          autoComplete="off"
          placeholder="e.g. 5"
          value={exerciseHours}
          onChange={(e) => setExerciseHours(e.target.value)}
          onKeyDown={submitOnEnter}
          className="w-full border border-line rounded-md px-3 py-2.5 bg-transparent mt-1 focus-within:border-accent focus:outline-none"
        />
        {parsedExerciseHours !== null && parsedExerciseHours > 0 && (
          <p className="text-[11px] text-accent mt-1">
            {parsedExerciseHours >= 7
              ? "Athlete formula will be used (≥ 7h/week)."
              : "Added directly to your estimated expenditure."}
          </p>
        )}
      </div>
      <button
        onClick={() => onSave({ sex, birthYear: Number(birthYear), heightCm: Number(heightCm), activityLevel, checkInDayOfWeek, weeklyExerciseHours: parsedExerciseHours })}
        disabled={!canSave || saving}
        className="w-full py-3 rounded-md bg-accent text-base disabled:opacity-40 font-medium"
        style={{ color: "#0B1210" }}
      >
        {saving ? "Saving…" : ctaLabel}
      </button>
    </div>
  );
}
