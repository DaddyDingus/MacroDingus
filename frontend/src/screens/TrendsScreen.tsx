import { useState } from "react";
import { useWeightTrend, useLogWeight } from "../api/weights";
import { useLogsHistory } from "../api/logs";
import { localDateString, addDays } from "../lib/date";
import WeightChart from "../components/WeightChart";
import MacroHistoryChart from "../components/MacroHistoryChart";

const RANGE_PRESETS = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
];

export default function TrendsScreen() {
  const [days, setDays] = useState(90);
  const trend = useWeightTrend(days);
  const history = useLogsHistory(Math.min(days, 90)); // macro bars past ~90 days get too dense to read
  const logWeight = useLogWeight();
  const [weightInput, setWeightInput] = useState("");

  const points = trend.data ?? [];
  const latest = points[points.length - 1];
  const weekAgoDate = latest ? addDays(latest.date, -7) : null;
  const weekAgoPoint = weekAgoDate ? [...points].reverse().find((p) => p.date <= weekAgoDate) : undefined;
  const weekDelta = latest && weekAgoPoint ? latest.trendKg - weekAgoPoint.trendKg : null;

  function submitWeight() {
    const kg = Number(weightInput);
    if (!kg || kg <= 0) return;
    logWeight.mutate({ date: localDateString(), weightKg: kg });
    setWeightInput("");
  }

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium">Trends</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <div className="border border-line bg-surface rounded-md p-4 flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            placeholder="Log today's weight"
            className="tabular flex-1 min-w-0 bg-transparent text-sm focus:outline-none placeholder:text-muted"
          />
          <span className="text-xs text-muted shrink-0">kg</span>
          <button
            onClick={submitWeight}
            disabled={!weightInput || logWeight.isPending}
            className="shrink-0 px-3 py-1.5 rounded-md bg-accent text-sm font-medium disabled:opacity-40"
            style={{ color: "#0B1210" }}
          >
            Log
          </button>
        </div>

        {latest && (
          <div className="border border-line bg-surface rounded-md p-4">
            <p className="text-[11px] tracking-widest uppercase text-muted">Trend weight</p>
            <p className="tabular text-3xl font-medium tracking-tight">{latest.trendKg.toFixed(1)} kg</p>
            {weekDelta !== null && (
              <p className="tabular text-xs text-muted mt-1">
                {weekDelta >= 0 ? "+" : ""}
                {weekDelta.toFixed(1)} kg over 7 days
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
          <WeightChart points={points} />
        </div>

        <div className="border border-line bg-surface rounded-md p-4">
          <p className="text-[11px] tracking-widest uppercase text-muted mb-1">Macros</p>
          <MacroHistoryChart history={history.data ?? []} />
        </div>
      </main>
    </div>
  );
}
