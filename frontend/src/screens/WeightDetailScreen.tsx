import { useState } from "react";
import { useWeightTrend, useWeights, useDeleteWeight } from "../api/weights";
import { addDays, formatDayLabel } from "../lib/date";
import { useWeightUnit, kgToUnit } from "../lib/weightUnit";
import WeightChart from "../components/WeightChart";
import LogWeightInline from "../components/LogWeightInline";

const RANGE_PRESETS = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
];

export default function WeightDetailScreen() {
  const [days, setDays] = useState(90);
  const { unit, setUnit } = useWeightUnit();
  const trend = useWeightTrend(days);
  const recentWeighIns = useWeights(30);
  const deleteWeight = useDeleteWeight();
  const [showRecent, setShowRecent] = useState(false);

  const points = trend.data ?? [];
  const latest = points[points.length - 1];
  const weekAgoDate = latest ? addDays(latest.date, -7) : null;
  const weekAgoPoint = weekAgoDate ? [...points].reverse().find((p) => p.date <= weekAgoDate) : undefined;
  const weekDeltaKg = latest && weekAgoPoint ? latest.trendKg - weekAgoPoint.trendKg : null;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3 flex items-center justify-between">
        <h1 className="text-lg font-medium">Weight</h1>
        <div className="flex rounded-full border border-line overflow-hidden text-xs">
          {(["kg", "lb"] as const).map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`px-2.5 py-1 ${unit === u ? "bg-accent" : "text-muted"}`}
              style={unit === u ? { color: "#0B1210" } : undefined}
            >
              {u}
            </button>
          ))}
        </div>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <LogWeightInline />

        {latest && (
          <div className="border border-line bg-surface rounded-md p-4">
            <p className="text-[11px] tracking-widest uppercase text-muted">Trend weight</p>
            <p className="tabular text-3xl font-medium tracking-tight">
              {kgToUnit(latest.trendKg, unit).toFixed(1)} {unit}
            </p>
            {weekDeltaKg !== null && (
              <p className="tabular text-xs text-muted mt-1">
                {weekDeltaKg >= 0 ? "+" : ""}
                {kgToUnit(weekDeltaKg, unit).toFixed(1)} {unit} over 7 days
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 px-1">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                days === p.days ? "border-accent text-accent" : "border-line text-muted"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="border border-line bg-surface rounded-md p-4">
          <p className="text-[11px] tracking-widest uppercase text-muted mb-1">Weight</p>
          <WeightChart points={points} unit={unit} />
        </div>

        {recentWeighIns.data && recentWeighIns.data.length > 0 && (
          <div className="border border-line bg-surface rounded-md overflow-hidden">
            <button
              onClick={() => setShowRecent((v) => !v)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-left"
            >
              <span className="text-[11px] tracking-widest uppercase text-muted">Recent weigh-ins</span>
              <span className="text-xs text-accent">{showRecent ? "Hide" : "Show"}</span>
            </button>
            {showRecent && (
              <div>
                {[...recentWeighIns.data]
                  .reverse()
                  .map((w) => (
                    <div
                      key={w.id}
                      className="flex items-center justify-between px-4 py-2 border-t border-line/60"
                    >
                      <span className="text-sm text-muted">{formatDayLabel(w.date)}</span>
                      <span className="flex items-center gap-3">
                        <span className="tabular text-sm">
                          {kgToUnit(w.weightKg, unit).toFixed(1)} {unit}
                        </span>
                        <button
                          onClick={() => deleteWeight.mutate(w.id)}
                          aria-label={`Delete weigh-in from ${formatDayLabel(w.date)}`}
                          className="text-muted text-base leading-none px-1"
                        >
                          ×
                        </button>
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
