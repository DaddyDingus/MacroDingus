import { useCheckinHistory } from "../api/coach";
import { useWeightUnit, kgToUnit } from "../lib/weightUnit";
import { kcalToUnit, energyUnitLabel, useEnergyUnit } from "../lib/energyUnit";
import { formatDayLabel } from "../lib/date";
import { staggerStyle } from "../lib/stagger";

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// Reached from the Dashboard's "Weekly update" tile — the one place in the
// app that lists individual check-ins as a history rather than deriving a
// chart from them (see backend/src/routes/coach.ts's GET /api/checkins,
// already unbounded/date-desc, extended with `narrative` for this screen).
export default function CheckinJournalScreen() {
  const checkinHistory = useCheckinHistory();
  const { unit } = useWeightUnit();
  const { unit: energyUnit } = useEnergyUnit();

  const checkinsDesc = [...(checkinHistory.data ?? [])].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium text-center">Check-in Journal</h1>
      </header>

      <main className="px-4 max-w-md mx-auto space-y-3">
        {checkinsDesc.length === 0 ? (
          <div className="border border-line bg-surface rounded-2xl p-4">
            <p className="text-sm text-muted">No check-ins yet.</p>
          </div>
        ) : (
          checkinsDesc.map((c, i) => (
            <div key={c.id} className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(i, 60, 8)}>
              <p className="text-sm font-medium text-ink">{formatDayLabel(c.date)}</p>
              <p className="text-xs text-muted tabular mt-0.5">
                Trend {kgToUnit(c.trendWeightKg, unit).toFixed(1)} {unit} · TDEE {fmt(kcalToUnit(c.tdee, energyUnit))} {energyUnitLabel(energyUnit)}
              </p>
              {c.narrative ? (
                <p className="text-sm text-ink mt-2 leading-relaxed">{c.narrative}</p>
              ) : (
                <p className="text-xs text-muted mt-2 italic">No summary generated for this check-in.</p>
              )}
            </div>
          ))
        )}
      </main>
    </div>
  );
}
