import { Link } from "react-router-dom";
import { useCoachStatus, type Profile } from "../api/coach";
import { useWeightUnit, kgToUnit, type WeightUnit } from "../lib/weightUnit";
import { formatDayLabel } from "../lib/date";
import { computeGoalProgressPercent } from "../lib/goalProgress";

export default function GoalProgressDetailScreen() {
  const status = useCoachStatus();
  const { unit } = useWeightUnit();
  const profile = status.data?.profile ?? null;
  const trendWeightKg = status.data?.trendWeightKg ?? null;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium">Goal progress</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        {!profile?.goalWeightKg ? (
          <div className="border border-line bg-surface rounded-md p-4 space-y-2">
            <p className="text-sm text-muted">You haven't set a goal weight yet.</p>
            <Link to="/strategy" className="text-sm text-accent inline-block">
              Set a goal weight →
            </Link>
          </div>
        ) : profile.goalStartWeightKg == null || trendWeightKg == null ? (
          <div className="border border-line bg-surface rounded-md p-4">
            <p className="text-sm text-muted">Log a weight to start tracking progress toward your goal.</p>
          </div>
        ) : (
          <GoalProgressBody profile={profile} trendWeightKg={trendWeightKg} unit={unit} />
        )}
      </main>
    </div>
  );
}

function GoalProgressBody({
  profile,
  trendWeightKg,
  unit,
}: {
  profile: Profile;
  trendWeightKg: number;
  unit: WeightUnit;
}) {
  const start = profile.goalStartWeightKg!;
  const goal = profile.goalWeightKg!;
  const clampedPercent = computeGoalProgressPercent(start, goal, trendWeightKg);
  const remainingKg = Math.abs(goal - trendWeightKg);

  return (
    <>
      <div className="border border-line bg-surface rounded-md p-4">
        <p className="text-[11px] tracking-widest uppercase text-muted">Progress to goal</p>
        <p className="tabular text-3xl font-medium tracking-tight">{clampedPercent.toFixed(0)}%</p>
        <p className="tabular text-xs text-muted mt-1">
          {kgToUnit(trendWeightKg, unit).toFixed(1)} {unit} → {kgToUnit(goal, unit).toFixed(1)} {unit}
        </p>
      </div>

      <div className="border border-line bg-surface rounded-md overflow-hidden">
        <div className="h-2 bg-surface-raised">
          <div className="h-full bg-accent" style={{ width: `${clampedPercent}%` }} />
        </div>
      </div>

      <div className="border border-line bg-surface rounded-md p-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] tracking-widest uppercase text-muted">Started at</p>
          <p className="tabular text-lg mt-0.5">
            {kgToUnit(start, unit).toFixed(1)} {unit}
          </p>
          {profile.goalStartedAt && (
            <p className="text-xs text-muted mt-0.5">{formatDayLabel(profile.goalStartedAt.slice(0, 10))}</p>
          )}
        </div>
        <div>
          <p className="text-[11px] tracking-widest uppercase text-muted">Remaining</p>
          <p className="tabular text-lg mt-0.5">
            {kgToUnit(remainingKg, unit).toFixed(1)} {unit}
          </p>
        </div>
      </div>
    </>
  );
}
