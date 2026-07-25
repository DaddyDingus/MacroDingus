import { useState } from "react";
import type { ActivityLevel, GoalType, Profile, ProfileInput } from "../api/coach";

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string; hint: string }[] = [
  { value: "sedentary", label: "Sedentary", hint: "Little to no exercise" },
  { value: "light", label: "Light", hint: "Exercise 1-3 days/week" },
  { value: "moderate", label: "Moderate", hint: "Exercise 3-5 days/week" },
  { value: "active", label: "Active", hint: "Exercise 6-7 days/week" },
  { value: "very_active", label: "Very active", hint: "Physical job or 2x/day training" },
];

const GOAL_DEFAULTS: Record<GoalType, number> = { cut: -0.5, bulk: 0.25, maintain: 0 };

export default function GoalSetupForm({
  initial,
  onCancel,
  onSave,
  saving,
}: {
  initial?: Profile;
  onCancel?: () => void;
  onSave: (input: ProfileInput) => void;
  saving: boolean;
}) {
  const [sex, setSex] = useState<"male" | "female">(initial?.sex ?? "male");
  const [birthYear, setBirthYear] = useState(String(initial?.birthYear ?? 1990));
  const [heightCm, setHeightCm] = useState(String(initial?.heightCm ?? 175));
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>(initial?.activityLevel ?? "moderate");
  const [goalType, setGoalType] = useState<GoalType>(initial?.goalType ?? "maintain");
  const [rate, setRate] = useState(String(initial?.targetRateKgPerWeek ?? 0));

  function selectGoal(g: GoalType) {
    setGoalType(g);
    setRate(String(GOAL_DEFAULTS[g]));
  }

  const canSave = Number(birthYear) > 1900 && Number(heightCm) > 0;

  function submit() {
    if (!canSave) return;
    onSave({
      sex,
      birthYear: Number(birthYear),
      heightCm: Number(heightCm),
      activityLevel,
      goalType,
      targetRateKgPerWeek: goalType === "maintain" ? 0 : Number(rate),
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted mb-1.5">Sex</p>
        <div className="flex gap-2">
          {(["male", "female"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSex(s)}
              className={`flex-1 py-2 rounded-md border text-sm capitalize ${
                sex === s ? "border-accent text-accent" : "border-line text-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs text-muted mb-1">Birth year</span>
          <input
            type="number"
            inputMode="numeric"
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value)}
            className="tabular w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Height (cm)</span>
          <input
            type="number"
            inputMode="decimal"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            className="tabular w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
          />
        </label>
      </div>

      <div>
        <p className="text-xs text-muted mb-1.5">Activity level</p>
        <div className="border border-line rounded-md overflow-hidden">
          {ACTIVITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setActivityLevel(opt.value)}
              className={`w-full flex items-center justify-between px-3 py-2.5 border-b border-line/60 last:border-b-0 text-left ${
                activityLevel === opt.value ? "bg-surface-raised" : ""
              }`}
            >
              <span>
                <span className={`block text-sm ${activityLevel === opt.value ? "text-accent" : ""}`}>{opt.label}</span>
                <span className="block text-xs text-muted">{opt.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-muted mb-1.5">Goal</p>
        <div className="flex gap-2">
          {(["cut", "bulk", "maintain"] as const).map((g) => (
            <button
              key={g}
              onClick={() => selectGoal(g)}
              className={`flex-1 py-2 rounded-md border text-sm capitalize ${
                goalType === g ? "border-accent text-accent" : "border-line text-muted"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {goalType !== "maintain" && (
        <label className="block">
          <span className="block text-xs text-muted mb-1">
            Target rate ({goalType === "cut" ? "negative to lose" : "positive to gain"})
          </span>
          <div className="flex items-center rounded-md bg-surface-raised border border-line px-3 focus-within:border-accent">
            <input
              type="number"
              inputMode="decimal"
              step="0.05"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="tabular w-full bg-transparent py-2.5 text-sm focus:outline-none"
            />
            <span className="text-xs text-muted">kg/week</span>
          </div>
        </label>
      )}

      <div className="flex gap-2 pt-1">
        {onCancel && (
          <button onClick={onCancel} className="px-4 py-3 rounded-md border border-line text-sm text-muted">
            Cancel
          </button>
        )}
        <button
          onClick={submit}
          disabled={!canSave || saving}
          className="flex-1 py-3 rounded-md bg-accent text-base disabled:opacity-40 font-medium"
          style={{ color: "#0B1210" }}
        >
          {saving ? "Saving…" : initial ? "Save changes" : "Set up"}
        </button>
      </div>
    </div>
  );
}
