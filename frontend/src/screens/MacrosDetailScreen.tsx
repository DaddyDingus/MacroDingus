import { useState } from "react";
import { useLogsHistory } from "../api/logs";
import MacroHistoryChart from "../components/MacroHistoryChart";

const RANGE_PRESETS = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export default function MacrosDetailScreen() {
  const [days, setDays] = useState(30);
  const history = useLogsHistory(days);

  const withEntries = (history.data ?? []).filter((d) => d.calories > 0);
  const avg7 =
    withEntries.length > 0
      ? {
          calories: withEntries.slice(-7).reduce((s, d) => s + d.calories, 0) / Math.min(7, withEntries.length),
          protein: withEntries.slice(-7).reduce((s, d) => s + d.protein, 0) / Math.min(7, withEntries.length),
          carbs: withEntries.slice(-7).reduce((s, d) => s + d.carbs, 0) / Math.min(7, withEntries.length),
          fat: withEntries.slice(-7).reduce((s, d) => s + d.fat, 0) / Math.min(7, withEntries.length),
        }
      : null;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium">Macros</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        {avg7 && (
          <div className="border border-line bg-surface rounded-md p-4 grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="tabular text-sm">{Math.round(avg7.calories)}</div>
              <div className="text-[11px] text-muted">kcal</div>
            </div>
            <div>
              <div className="tabular text-sm text-protein">{avg7.protein.toFixed(1)}</div>
              <div className="text-[11px] text-muted">protein</div>
            </div>
            <div>
              <div className="tabular text-sm text-carbs">{avg7.carbs.toFixed(1)}</div>
              <div className="text-[11px] text-muted">carbs</div>
            </div>
            <div>
              <div className="tabular text-sm text-fat">{avg7.fat.toFixed(1)}</div>
              <div className="text-[11px] text-muted">fat</div>
            </div>
            <div className="col-span-4 text-[11px] text-muted pt-1">daily avg, last 7 logged days</div>
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
          <p className="text-[11px] tracking-widest uppercase text-muted mb-1">Macros</p>
          <MacroHistoryChart history={history.data ?? []} />
        </div>
      </main>
    </div>
  );
}
