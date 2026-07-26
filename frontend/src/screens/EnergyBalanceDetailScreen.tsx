import { useState } from "react";
import { useLogsHistory } from "../api/logs";
import { useCheckinHistory } from "../api/coach";
import { activeCheckinForDate } from "../lib/checkins";
import RangeToggle from "../components/RangeToggle";
import EnergyBalanceChart from "../components/EnergyBalanceChart";

const RANGE_PRESETS = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
];

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function EnergyBalanceDetailScreen() {
  const [days, setDays] = useState(30);
  const history = useLogsHistory(days);
  const checkinHistory = useCheckinHistory();
  const checkinsAsc = [...(checkinHistory.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  const withActiveTdee = (history.data ?? [])
    .map((d) => ({ ...d, tdee: activeCheckinForDate(checkinsAsc, d.date)?.tdee ?? null }))
    .filter((d) => d.tdee !== null);
  const last7 = withActiveTdee.slice(-7);
  const avgBalance =
    last7.length > 0 ? last7.reduce((s, d) => s + (d.calories - (d.tdee as number)), 0) / last7.length : null;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium">Energy balance</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        {avgBalance !== null ? (
          <div className="border border-line bg-surface rounded-md p-4">
            <p className="text-[11px] tracking-widest uppercase text-muted">Avg balance, last 7 days</p>
            <p className="tabular text-3xl font-medium tracking-tight">
              {avgBalance >= 0 ? "+" : ""}
              {fmt(avgBalance)} kcal/day
            </p>
            <p className="text-xs text-muted mt-1">{avgBalance >= 0 ? "Average surplus" : "Average deficit"}</p>
          </div>
        ) : (
          <p className="text-sm text-muted px-1">Check in from Strategy to see your energy balance.</p>
        )}

        <RangeToggle presets={RANGE_PRESETS} value={days} onChange={setDays} />

        <div className="border border-line bg-surface rounded-md p-4">
          <p className="text-[11px] tracking-widest uppercase text-muted mb-1">Calories in vs. out</p>
          <EnergyBalanceChart history={history.data ?? []} checkins={checkinsAsc} />
        </div>
      </main>
    </div>
  );
}
