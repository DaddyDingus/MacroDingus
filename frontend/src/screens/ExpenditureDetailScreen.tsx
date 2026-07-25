import { useCoachStatus, useCheckinHistory } from "../api/coach";
import { formatDayLabel } from "../lib/date";
import TdeeChart from "../components/TdeeChart";

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export default function ExpenditureDetailScreen() {
  const status = useCoachStatus();
  const checkinHistory = useCheckinHistory();

  const checkin = status.data?.latestCheckin ?? null;
  const checkinsAsc = [...(checkinHistory.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const previous = checkinsAsc.length >= 2 ? checkinsAsc[checkinsAsc.length - 2] : null;
  const delta = checkin && previous ? checkin.tdee - previous.tdee : null;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium">Expenditure</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        {checkin ? (
          <div className="border border-line bg-surface rounded-md p-4">
            <p className="text-[11px] tracking-widest uppercase text-muted">Estimated TDEE</p>
            <p className="tabular text-3xl font-medium tracking-tight">{fmt(checkin.tdee)} kcal</p>
            {delta !== null && (
              <p className="tabular text-xs text-muted mt-1">
                {delta >= 0 ? "+" : ""}
                {fmt(delta)} kcal since last check-in
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted px-1">Check in from Strategy to get your first TDEE estimate.</p>
        )}

        {checkin && (
          <div className="border border-line bg-surface rounded-md p-4 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] tracking-widest uppercase text-muted">Target calories</p>
              <p className="tabular text-lg mt-0.5">{fmt(checkin.targetCalories)} kcal</p>
            </div>
            <div>
              <p className="text-[11px] tracking-widest uppercase text-muted">As of</p>
              <p className="text-lg mt-0.5">{formatDayLabel(checkin.date)}</p>
            </div>
          </div>
        )}

        <div className="border border-line bg-surface rounded-md p-4">
          <p className="text-[11px] tracking-widest uppercase text-muted mb-1">TDEE over time</p>
          <TdeeChart checkins={checkinsAsc} />
        </div>

        {checkinsAsc.length > 0 && (
          <div className="border border-line bg-surface rounded-md overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line">
              <span className="text-[11px] tracking-widest uppercase text-muted">Check-in history</span>
            </div>
            {[...checkinsAsc].reverse().map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-2 border-b border-line/60 last:border-b-0">
                <span className="text-sm text-muted">{formatDayLabel(c.date)}</span>
                <span className="tabular text-sm">
                  {fmt(c.targetCalories)} kcal · {fmt(c.tdee)} TDEE
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
