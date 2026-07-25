import { useState } from "react";
import { useCoachStatus, useSaveProfile, useCheckIn } from "../api/coach";
import GoalSetupForm from "../components/GoalSetupForm";

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export default function CoachScreen() {
  const status = useCoachStatus();
  const saveProfile = useSaveProfile();
  const checkIn = useCheckIn();
  const [editingGoal, setEditingGoal] = useState(false);

  if (status.isLoading) return null;

  const profile = status.data?.profile ?? null;
  const checkin = status.data?.latestCheckin ?? null;

  if (!profile) {
    return (
      <div className="min-h-dvh pb-24">
        <header className="px-4 pt-5 pb-3">
          <h1 className="text-lg font-medium">Coach</h1>
          <p className="text-sm text-muted mt-1">
            Set up your goal to get daily targets that adapt to your actual data over time.
          </p>
        </header>
        <main className="px-4 max-w-md mx-auto">
          <GoalSetupForm saving={saveProfile.isPending} onSave={(input) => saveProfile.mutate(input)} />
        </main>
      </div>
    );
  }

  if (editingGoal) {
    return (
      <div className="min-h-dvh pb-24">
        <header className="px-4 pt-5 pb-3">
          <h1 className="text-lg font-medium">Edit goal</h1>
        </header>
        <main className="px-4 max-w-md mx-auto">
          <GoalSetupForm
            initial={profile}
            saving={saveProfile.isPending}
            onCancel={() => setEditingGoal(false)}
            onSave={(input) =>
              saveProfile.mutate(input, {
                onSuccess: () => setEditingGoal(false),
              })
            }
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3 flex items-center justify-between">
        <h1 className="text-lg font-medium">Coach</h1>
        <button onClick={() => setEditingGoal(true)} className="text-xs text-accent">
          Edit goal
        </button>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        {checkin ? (
          <div className="border border-line bg-surface rounded-md overflow-hidden">
            <div className="px-5 pt-4 pb-2">
              <p className="text-[11px] tracking-widest uppercase text-muted">Daily target</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="tabular text-4xl font-medium tracking-tight">{fmt(checkin.targetCalories)}</span>
                <span className="text-sm text-muted">kcal</span>
              </div>
            </div>
            <div className="h-[3px] bg-ink" />
            <div className="px-5 py-2.5 flex items-center justify-between border-b border-line/70">
              <span className="flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-protein" /> Protein
              </span>
              <span className="tabular text-sm">{fmt(checkin.targetProteinG, 1)} g</span>
            </div>
            <div className="px-5 py-2.5 flex items-center justify-between border-b border-line/70">
              <span className="flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-carbs" /> Carbs
              </span>
              <span className="tabular text-sm">{fmt(checkin.targetCarbsG, 1)} g</span>
            </div>
            <div className="px-5 py-2.5 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-fat" /> Fat
              </span>
              <span className="tabular text-sm">{fmt(checkin.targetFatG, 1)} g</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted px-1">
            Log a weight to get your first set of targets.
          </p>
        )}

        {checkin && (
          <div className="border border-line bg-surface rounded-md p-4 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] tracking-widest uppercase text-muted">Estimated TDEE</p>
              <p className="tabular text-lg mt-0.5">{fmt(checkin.tdee)} kcal</p>
            </div>
            <div>
              <p className="text-[11px] tracking-widest uppercase text-muted">Trend weight</p>
              <p className="tabular text-lg mt-0.5">{checkin.trendWeightKg.toFixed(1)} kg</p>
            </div>
          </div>
        )}

        <div className="border border-line bg-surface rounded-md p-4">
          <p className="text-sm text-muted mb-3">
            {status.data?.daysSinceCheckin === null
              ? "You haven't checked in yet."
              : status.data?.daysSinceCheckin === 0
                ? "You checked in today."
                : `${status.data?.daysSinceCheckin} day${status.data?.daysSinceCheckin === 1 ? "" : "s"} since your last check-in.`}
          </p>
          <button
            onClick={() => checkIn.mutate()}
            disabled={checkIn.isPending}
            className="w-full py-3 rounded-md bg-accent text-base disabled:opacity-40 font-medium"
            style={{ color: "#0B1210" }}
          >
            {checkIn.isPending ? "Checking in…" : "Check in"}
          </button>
          <p className="text-xs text-muted mt-2">
            Recalculates your targets from your recent weight trend and logged calories. Do this about once a
            week — check in any time, there's no penalty for checking in early or late.
          </p>
        </div>
      </main>
    </div>
  );
}
