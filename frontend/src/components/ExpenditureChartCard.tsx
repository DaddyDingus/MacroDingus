import { useMemo, useState } from "react";
import type { DailyExpenditurePoint } from "../api/coach";
import { dayIndex, localDateString } from "../lib/date";
import { RANGE_PRESETS, MUTED } from "../lib/chartLayout";
import { useChartGesture } from "../hooks/useChartGesture";
import TdeeChart, { ACCENT, HOLDING_COLOR } from "./TdeeChart";
import ChartCard from "./ChartCard";

export default function ExpenditureChartCard({
  dailyFlux,
  onViewChange,
}: {
  dailyFlux: DailyExpenditurePoint[];
  onViewChange: (start: string, end: string) => void;
}) {
  // Earliest date there's anything to show — the daily backfill only has a
  // row once the adaptive engine has enough trailing data, so its own
  // earliest date is the authoritative "when did the chart actually start
  // having something to show" signal now that it's the chart's sole data
  // source. Falls back to "today" (no floor at all) rather than some small
  // fixed window while it's still loading — this only bounds how far a
  // pan/pinch gesture can travel once the user is actually interacting, by
  // which point real data has loaded; it must never influence the *initial*
  // window, since that renders before the query has resolved on every load.
  const earliestTs = useMemo(() => {
    if (dailyFlux.length === 0) return dayIndex(localDateString());
    return Math.min(...dailyFlux.map((p) => dayIndex(p.date)));
  }, [dailyFlux]);

  const [showFlux, setShowFlux] = useState(true);

  const gesture = useChartGesture({ earliestTs, initialDays: 30, onViewChange });

  return (
    <ChartCard
      gesture={gesture}
      presets={RANGE_PRESETS}
      legend={
        <>
          <button
            type="button"
            onClick={() => setShowFlux((v) => !v)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
              showFlux ? "border-accent text-accent" : "border-line text-muted"
            }`}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: showFlux ? ACCENT : MUTED, opacity: 0.4 }} />
            Flux Range
          </button>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="inline-block w-3 h-[2px]" style={{ background: ACCENT }} />
            Expenditure
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="inline-block w-2 h-2" style={{ border: `1.5px solid ${HOLDING_COLOR}` }} />
            Holding
          </span>
        </>
      }
    >
      {(windowStart, windowEnd, height) => (
        <TdeeChart
          dailyFlux={dailyFlux}
          windowStart={windowStart}
          windowEnd={windowEnd}
          height={height}
          showFlux={showFlux}
        />
      )}
    </ChartCard>
  );
}
