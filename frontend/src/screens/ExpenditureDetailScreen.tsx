import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Scale, UtensilsCrossed } from "lucide-react";
import { useCoachStatus, useExpenditureDailySeries } from "../api/coach";
import { formatDayLabel, localDateString } from "../lib/date";
import { useEnergyUnit, kcalToUnit, formatEnergy, energyUnitLabel } from "../lib/energyUnit";
import { sampleDailyExpenditure, expenditureChangeOverDays } from "../lib/expenditureInsights";
import { changeDirection, changeDirectionLabel } from "../lib/changeIndicator";
import ExpenditureChartCard from "../components/ExpenditureChartCard";
import MiniLineSpark from "../components/MiniLineSpark";
import ChangeDirectionIcon from "../components/ChangeDirectionIcon";
import MonthSection from "../components/MonthSection";
import CollapsibleCard from "../components/CollapsibleCard";
import StatTile from "../components/StatTile";
import { staggerStyle } from "../lib/stagger";

const CHANGE_WINDOWS = [3, 7, 14, 30, 90];
const EXPENDITURE_CHANGE_EPSILON = 5; // kcal — smaller than this reads as "no change", not a real move

// Full history in one shot, same as check-ins/weights elsewhere in this app —
// at this app's personal-diary scale a few years of daily points is trivial,
// and it lets ExpenditureChartCard's pan/pinch gestures re-slice a
// already-loaded array instead of refetching mid-gesture.
const DAILY_SERIES_DAYS = 3650;

function formatRangeDate(dateStr: string, withYear: boolean): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: withYear ? "numeric" : undefined,
  });
}

function formatRangeLabel(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatRangeDate(endDate, true);
  return `${formatRangeDate(startDate, false)} – ${formatRangeDate(endDate, true)}`;
}

function signed(n: number): string {
  return n >= 0 ? `+${Math.round(n).toLocaleString()}` : Math.round(n).toLocaleString();
}

function AdaptiveReadinessCard({
  coverage,
}: {
  coverage: NonNullable<ReturnType<typeof useCoachStatus>["data"]>["expenditureCoverage"];
}) {
  return (
    <div className="border border-line bg-surface rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Adaptive readiness</p>
          <p className="text-xs text-muted mt-0.5">
            {coverage.ready ? "Ready for your next check-in." : "Building your personal expenditure estimate."}
          </p>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full ${coverage.ready ? "bg-carbs/15 text-carbs" : "bg-line/30 text-muted"}`}>
          {coverage.ready ? "Ready" : "Collecting"}
        </span>
      </div>
      {[
        { label: "Complete food-log days", value: coverage.nutritionDays, required: coverage.nutritionDaysRequired },
        { label: "Weigh-ins in range", value: coverage.weighIns, required: coverage.weighInsRequired },
      ].map((row) => {
        const progress = Math.min(100, (row.value / row.required) * 100);
        return (
          <div key={row.label}>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-muted">{row.label}</span>
              <span className="tabular">{row.value}/{row.required}{row.label.startsWith("Weigh") ? "+" : ""}</span>
            </div>
            <div className="h-1.5 rounded-full bg-line/40 overflow-hidden">
              <div className="h-full rounded-full bg-expenditure" style={{ width: `${progress}%` }} />
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-muted">Days marked incomplete are not counted.</p>
    </div>
  );
}

export default function ExpenditureDetailScreen() {
  const navigate = useNavigate();
  const status = useCoachStatus();
  const dailySeries = useExpenditureDailySeries(DAILY_SERIES_DAYS);
  const { unit: energyUnit } = useEnergyUnit();

  // Still the "last official check-in" snapshot, used only for the Current
  // Expenditure/Current Strategy tiles below — the graph, header stat, and
  // change-window sparks all switched to the daily backfill (`dailyAsc`)
  // instead, so this and that never disagree about what "this window's
  // number" means (see TdeeChart.tsx and expenditureInsights.ts).
  const checkin = status.data?.latestCheckin ?? null;
  const dailyAsc = dailySeries.data ?? [];

  const today = localDateString();
  // Fed by ExpenditureChartCard's pan/pinch gestures — the Average/Difference
  // summary below tracks whatever window is actually visible, live, rather
  // than a static preset. Defaults to the card's own initial 30-day window
  // (kept in sync via onViewChange on mount) so there's no flash of "—".
  const [view, setView] = useState({ start: today, end: today });
  const handleViewChange = useCallback((start: string, end: string) => setView({ start, end }), []);

  const rangeSample = useMemo(
    () => sampleDailyExpenditure(dailyAsc, view.start, view.end),
    [dailyAsc, view.start, view.end]
  );
  const rangeAvgKcal = rangeSample.length
    ? rangeSample.reduce((sum, p) => sum + p.tdee, 0) / rangeSample.length
    : null;
  const rangeDiffKcal =
    rangeSample.length >= 2 ? rangeSample[rangeSample.length - 1].tdee - rangeSample[0].tdee : null;
  const rangeLabel = rangeSample.length ? formatRangeLabel(rangeSample[0].date, rangeSample[rangeSample.length - 1].date) : null;

  const strategy = checkin?.usedAdaptiveTdee === true ? "adaptive" : checkin?.usedAdaptiveTdee === false ? "formula" : null;
  const coverage = status.data?.expenditureCoverage ?? null;
  const showAdaptiveReadiness = coverage !== null && strategy !== "adaptive";

  // Daily history rows: delta is always against the previous entry in the
  // *full* series (so a row at the visible window's edge still shows a real
  // change rather than treating itself as day one), then the whole thing is
  // filtered down to the currently panned/zoomed window — panning the chart
  // updates this list too, one cohesive interactive surface. Days the
  // adaptive engine couldn't produce an estimate for are absent from
  // `dailyAsc` entirely (see GET /api/coach/expenditure-daily), so they're
  // simply not rows here — no fabricated placeholder.
  const dailyRowsDesc = useMemo(() => {
    const withDelta = dailyAsc.map((p, i) => ({
      date: p.date,
      tdee: p.tdee,
      delta: i > 0 ? p.tdee - dailyAsc[i - 1].tdee : null,
    }));
    return withDelta
      .filter((p) => p.date >= view.start && p.date <= view.end)
      .reverse();
  }, [dailyAsc, view.start, view.end]);

  const monthGroups = new Map<string, { label: string; entries: typeof dailyRowsDesc }>();
  dailyRowsDesc.forEach((p) => {
    const key = p.date.slice(0, 7);
    if (!monthGroups.has(key)) {
      const [y, m] = key.split("-").map(Number);
      monthGroups.set(key, {
        label: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        entries: [],
      });
    }
    monthGroups.get(key)!.entries.push(p);
  });
  const monthGroupsDesc = [...monthGroups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, g]) => ({ key, label: g.label, entries: g.entries }));
  const currentMonth = today.slice(0, 7);

  let block = 0;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium text-center">Expenditure</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        {showAdaptiveReadiness && coverage && (
          <div className="tile-enter" style={staggerStyle(block++, 60, 5)}>
            <AdaptiveReadinessCard coverage={coverage} />
          </div>
        )}

        <div className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(block++, 60, 5)}>
          <div className="relative grid grid-cols-2 gap-6">
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10" />
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Average</p>
              <p className="tabular text-2xl font-medium tracking-tight whitespace-nowrap">
                {rangeAvgKcal !== null ? Math.round(kcalToUnit(rangeAvgKcal, energyUnit)).toLocaleString() : "—"}{" "}
                <span className="text-sm font-normal text-muted">{energyUnitLabel(energyUnit)}</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Difference</p>
              <p className="tabular text-2xl font-medium tracking-tight whitespace-nowrap">
                {rangeDiffKcal !== null ? signed(kcalToUnit(rangeDiffKcal, energyUnit)) : "—"}{" "}
                <span className="text-sm font-normal text-muted">{energyUnitLabel(energyUnit)}</span>
              </p>
            </div>
          </div>
          {rangeLabel ? (
            <p className="text-xs text-muted mt-2 text-center">{rangeLabel}</p>
          ) : (
            <p className="text-xs text-muted mt-2 text-center">Check in from Strategy to get your first estimate.</p>
          )}
        </div>

        <div className="tile-enter" style={staggerStyle(block++, 60, 5)}>
          <ExpenditureChartCard dailyFlux={dailyAsc} onViewChange={handleViewChange} />
        </div>

        <p className="text-[11px] tracking-widest uppercase text-muted px-1 pt-2">Insights &amp; Data</p>

        <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
          <div className="px-4 py-2.5 border-b border-line">
            <span className="text-[11px] tracking-widest uppercase text-muted">Expenditure changes</span>
          </div>
          {CHANGE_WINDOWS.map((w) => {
            const stat = expenditureChangeOverDays(dailyAsc, w);
            if (stat.deltaKcal === null) {
              return (
                <div key={w} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 last:border-b-0">
                  <span className="text-sm text-muted w-12 shrink-0">{w}-day</span>
                  <div className="flex-1 flex items-center justify-end pr-8">
                    <span className="text-[11px] text-muted/60 bg-line/20 px-3 py-1 rounded-full">Not enough data</span>
                  </div>
                </div>
              );
            }
            const dir = changeDirection(stat.deltaKcal, EXPENDITURE_CHANGE_EPSILON);
            const seriesInUnit = stat.series.map((kcal) => kcalToUnit(kcal, energyUnit));
            return (
              <div key={w} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 last:border-b-0">
                <span className="text-sm text-muted w-12 shrink-0">{w}-day</span>
                <div className="flex-1 h-7 min-w-0">
                  <MiniLineSpark values={seriesInUnit} color="#D95926" />
                </div>
                <span className="tabular text-sm w-24 text-right shrink-0 whitespace-nowrap">
                  {signed(kcalToUnit(stat.deltaKcal, energyUnit))} {energyUnitLabel(energyUnit)}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted w-[86px] justify-end shrink-0">
                  <ChangeDirectionIcon direction={dir} colorClassName="text-expenditure" />
                  {changeDirectionLabel(dir)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="tile-enter space-y-3" style={staggerStyle(block++, 60, 5)}>
          <StatTile
            value={checkin ? Math.round(kcalToUnit(checkin.tdee, energyUnit)).toLocaleString() : "—"}
            unit={energyUnitLabel(energyUnit)}
            label="Current Expenditure"
            description="The latest estimate of your daily energy expenditure, based on your weight trend and nutrition data."
          />
          <StatTile
            value={strategy === "adaptive" ? "Adaptive" : strategy === "formula" ? "Estimated" : "—"}
            valueClassName="text-lg"
            label="Current Strategy"
            description={
              <>
                {strategy === "adaptive" &&
                  "Calculated from your actual weight trend and logged calories over the past three weeks."}
                {strategy === "formula" &&
                  "Based on a formula using your profile. Switches to your real data once you have 2+ weigh-ins spanning enough time and 11+ overlapping days of nutrition logging in a 3-week period."}
                {strategy === null && "Check in from Strategy to see how your estimate is being calculated."}
              </>
            }
          />
        </div>

        <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
          <div className="px-4 py-2.5 border-b border-line">
            <span className="text-[11px] tracking-widest uppercase text-muted">Data sources</span>
          </div>
          <button
            onClick={() => navigate("/scale-weight")}
            className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-line/60 text-left active:bg-surface-raised"
          >
            <span className="w-7 h-7 rounded-full bg-surface-raised flex items-center justify-center shrink-0">
              <Scale className="w-3.5 h-3.5 text-muted" strokeWidth={2} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm">Scale Weight</span>
              <span className="block text-xs text-muted">Manage data</span>
            </span>
            <span className="text-muted text-lg leading-none">›</span>
          </button>
          <button
            onClick={() => navigate("/log")}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-surface-raised"
          >
            <span className="w-7 h-7 rounded-full bg-surface-raised flex items-center justify-center shrink-0">
              <UtensilsCrossed className="w-3.5 h-3.5 text-muted" strokeWidth={2} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm">Food Log</span>
              <span className="block text-xs text-muted">Manage data</span>
            </span>
            <span className="text-muted text-lg leading-none">›</span>
          </button>
        </div>

        {monthGroupsDesc.length > 0 && (
          <div className="tile-enter" style={staggerStyle(block++, 60, 5)}>
            <CollapsibleCard label="Daily history">
              {monthGroupsDesc.map((g) => (
                <MonthSection
                  key={g.key}
                  label={g.label}
                  summary={`${g.entries.length} ${g.entries.length === 1 ? "day" : "days"}`}
                  defaultOpen={g.key === currentMonth}
                >
                  {g.entries.map((p) => {
                    const dir = changeDirection(p.delta, EXPENDITURE_CHANGE_EPSILON);
                    return (
                      <div key={p.date} className="flex items-center justify-between px-4 py-2.5 border-t border-line/60">
                        <div>
                          <p className="tabular text-sm">{formatEnergy(p.tdee, energyUnit)}</p>
                          <p className="text-xs text-muted">{formatDayLabel(p.date)}</p>
                        </div>
                        <span className="flex items-center gap-2">
                          <span className="tabular text-sm">
                            {p.delta !== null
                              ? `${signed(kcalToUnit(p.delta, energyUnit))} ${energyUnitLabel(energyUnit)}`
                              : "—"}
                          </span>
                          <ChangeDirectionIcon direction={dir} colorClassName="text-expenditure" />
                        </span>
                      </div>
                    );
                  })}
                </MonthSection>
              ))}
            </CollapsibleCard>
          </div>
        )}
      </main>
    </div>
  );
}
