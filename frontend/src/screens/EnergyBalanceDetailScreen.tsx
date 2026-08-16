import { useMemo, useState } from "react";
import { Flame, Target } from "lucide-react";
import { useLogsHistory } from "../api/logs";
import { useCheckinHistory } from "../api/coach";
import { usePrograms } from "../api/programs";
import { formatDayLabel, localDateString, addDays, dayIndex } from "../lib/date";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import { buildDailyBalance, averageBalanceOverDays, balanceLabel, type EnergyBalanceTab } from "../lib/energyBalanceInsights";
import { changeDirection } from "../lib/changeIndicator";
import { activeCheckinForDate } from "../lib/checkins";
import { targetsForDate } from "../lib/programTargets";
import { useChartGesture } from "../hooks/useChartGesture";
import { RANGE_PRESETS } from "../lib/chartLayout";
import ScreenTabs from "../components/ScreenTabs";
import ChartCard from "../components/ChartCard";
import EnergyBalanceChart, { EnergyBalanceChartLegend } from "../components/EnergyBalanceChart";
import MiniLineSpark from "../components/MiniLineSpark";
import ChangeDirectionIcon from "../components/ChangeDirectionIcon";
import MonthSection from "../components/MonthSection";
import CollapsibleCard from "../components/CollapsibleCard";
import { staggerStyle } from "../lib/stagger";

const CHANGE_WINDOWS = [3, 7, 14, 30, 90];
const BALANCE_EPSILON = 5; // kcal — smaller than this reads as balanced/on-target, not a real deficit/surplus

const TAB_CONFIG: Record<EnergyBalanceTab, { chartLabel: string; insightsLabel: string; color: string; colorClassName: string }> = {
  expenditure: { chartLabel: "Expenditure", insightsLabel: "Relative to Expenditure", color: "#D95926", colorClassName: "text-expenditure" },
  targets: { chartLabel: "Targets", insightsLabel: "Relative to Targets", color: "#F7D372", colorClassName: "text-fat" },
};

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

export default function EnergyBalanceDetailScreen() {
  const [tab, setTab] = useState<EnergyBalanceTab>("expenditure");
  const { unit: energyUnit } = useEnergyUnit();
  const config = TAB_CONFIG[tab];

  // One dense fetch covers everything on this screen. buildDailyBalance()
  // discards its explicitly marked unlogged gaps so they never become
  // fabricated zero-intake days.
  const fullHistory = useLogsHistory(3650);
  const checkinHistory = useCheckinHistory();
  const checkinsAsc = [...(checkinHistory.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const programs = usePrograms();
  const programList = programs.data ?? [];

  const compareValueForDate =
    tab === "expenditure"
      ? (date: string) => activeCheckinForDate(checkinsAsc, date)?.tdee ?? null
      : (date: string) => targetsForDate(programList, date)?.calories ?? null;
  const allBalance = buildDailyBalance(fullHistory.data ?? [], compareValueForDate);

  const earliestTs = useMemo(
    () => (allBalance.length ? dayIndex(allBalance[0].date) : dayIndex(localDateString())),
    [allBalance]
  );
  const gesture = useChartGesture({ earliestTs, initialDays: 7 });

  const chartBalance = useMemo(
    () => allBalance.filter((p) => dayIndex(p.date) >= gesture.view.start && dayIndex(p.date) <= gesture.view.end),
    [allBalance, gesture.view]
  );

  const rangeAvg = chartBalance.length ? chartBalance.reduce((s, p) => s + p.balance, 0) / chartBalance.length : null;
  const rangeTotal = chartBalance.length ? chartBalance.reduce((s, p) => s + p.balance, 0) : null;
  const rangeLabel = chartBalance.length ? formatRangeLabel(chartBalance[0].date, chartBalance[chartBalance.length - 1].date) : null;
  const summaryLabel = tab === "targets" ? "Average" : balanceLabel(changeDirection(rangeAvg, BALANCE_EPSILON), "expenditure");

  const chartData = chartBalance.map((p) => ({ date: p.date, calories: p.calories, compare: p.compare }));

  const today = localDateString();
  const monthGroups = new Map<string, { label: string; entries: typeof allBalance }>();
  [...allBalance].forEach((p) => {
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
    .map(([key, g]) => ({ key, label: g.label, entries: [...g.entries].reverse() }));

  let block = 0;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium text-center">Energy Balance</h1>
      </header>

      <ScreenTabs
        options={[
          { value: "expenditure", label: "Expenditure", icon: <Flame className="w-4 h-4" strokeWidth={2} /> },
          { value: "targets", label: "Calorie Targets", icon: <Target className="w-4 h-4" strokeWidth={2} /> },
        ]}
        value={tab}
        onChange={setTab}
      />

      <main className="px-4 pt-3 space-y-3 max-w-md mx-auto">
        <div className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(block++, 60, 5)}>
          <div className="relative grid grid-cols-2 gap-6">
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10" />
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">{summaryLabel}</p>
              <p className="tabular text-2xl font-medium tracking-tight whitespace-nowrap">
                {rangeAvg !== null ? signed(kcalToUnit(rangeAvg, energyUnit)) : "—"}{" "}
                <span className="text-sm font-normal text-muted">{energyUnitLabel(energyUnit)}</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Total</p>
              <p className="tabular text-2xl font-medium tracking-tight whitespace-nowrap">
                {rangeTotal !== null ? signed(kcalToUnit(rangeTotal, energyUnit)) : "—"}{" "}
                <span className="text-sm font-normal text-muted">{energyUnitLabel(energyUnit)}</span>
              </p>
            </div>
          </div>
          {rangeLabel ? (
            <p className="text-xs text-muted mt-2 text-center">{rangeLabel}</p>
          ) : (
            <p className="text-xs text-muted mt-2 text-center">
              {tab === "expenditure"
                ? "Log food and check in from Strategy to see your energy balance."
                : "Log food and set a program to compare against your calorie targets."}
            </p>
          )}
        </div>

        <div className="tile-enter" style={staggerStyle(block++, 60, 5)}>
          <ChartCard
            gesture={gesture}
            presets={RANGE_PRESETS}
            legend={<EnergyBalanceChartLegend compareLabel={config.chartLabel} compareColor={config.color} />}
          >
            {(windowStart, windowEnd, height) => (
              <EnergyBalanceChart
                data={chartData}
                compareLabel={config.chartLabel}
                compareColor={config.color}
                emptyMessage={
                  tab === "expenditure"
                    ? "Log food and check in at least once to see this chart."
                    : "Log food and set a program to see this chart."
                }
                windowStart={windowStart}
                windowEnd={windowEnd}
                height={height}
              />
            )}
          </ChartCard>
        </div>

        <p className="text-[11px] tracking-widest uppercase text-muted px-1 pt-2">Insights &amp; Data</p>

        <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
          <div className="px-4 py-2.5 border-b border-line">
            <span className="text-[11px] tracking-widest uppercase text-muted">{config.insightsLabel}</span>
          </div>
          {CHANGE_WINDOWS.map((w) => {
            const avg = averageBalanceOverDays(allBalance, w);
            if (avg === null) {
              return (
                <div key={w} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 last:border-b-0">
                  <span className="text-sm text-muted w-12 shrink-0">{w}-day</span>
                  <div className="flex-1 flex items-center justify-end pr-8">
                    <span className="text-[11px] text-muted/60 bg-line/20 px-3 py-1 rounded-full">Not enough data</span>
                  </div>
                </div>
              );
            }
            const windowStart = addDays(today, -(w - 1));
            const windowPoints = allBalance.filter((p) => p.date >= windowStart);
            const dir = changeDirection(avg, BALANCE_EPSILON);
            const seriesInUnit = windowPoints.map((p) => kcalToUnit(p.balance, energyUnit));
            return (
              <div key={w} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 last:border-b-0">
                <span className="text-sm text-muted w-12 shrink-0">{w}-day</span>
                <div className="flex-1 h-7 min-w-0">
                  <MiniLineSpark values={seriesInUnit} color={config.color} />
                </div>
                <span className="tabular text-sm w-24 text-right shrink-0 whitespace-nowrap">
                  {signed(kcalToUnit(avg, energyUnit))} {energyUnitLabel(energyUnit)}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted w-[110px] justify-end shrink-0">
                  <ChangeDirectionIcon direction={dir} colorClassName={config.colorClassName} />
                  {balanceLabel(dir, tab)}
                </span>
              </div>
            );
          })}
        </div>

        {monthGroupsDesc.length > 0 && (
          <div className="tile-enter" style={staggerStyle(block++, 60, 5)}>
            <CollapsibleCard label="History">
              {monthGroupsDesc.map((g) => (
                <MonthSection
                  key={g.key}
                  label={g.label}
                  summary={`${g.entries.length} ${g.entries.length === 1 ? "day" : "days"}`}
                >
                  {g.entries.map((p) => {
                    const dir = changeDirection(p.balance, BALANCE_EPSILON);
                    return (
                      <div key={p.date} className="flex items-center justify-between px-4 py-2.5 border-t border-line/60">
                        <div>
                          <p className="tabular text-sm">
                            {signed(kcalToUnit(p.balance, energyUnit))} {energyUnitLabel(energyUnit)}
                          </p>
                          <p className="text-xs text-muted">{formatDayLabel(p.date)}</p>
                        </div>
                        <span className="flex items-center gap-1 text-xs text-muted">
                          <ChangeDirectionIcon direction={dir} colorClassName={config.colorClassName} />
                          {balanceLabel(dir, tab)}
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
