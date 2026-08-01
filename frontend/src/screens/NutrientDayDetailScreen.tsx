import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useDayLog, useLogsHistory } from "../api/logs";
import { usePrograms } from "../api/programs";
import { formatDayLabel } from "../lib/date";
import { targetsForDate } from "../lib/programTargets";
import { computeNutrientWindowStats } from "../lib/dayWindowStats";
import { topContributors } from "../lib/nutrientContributors";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import { METRIC_CONFIG, type MetricId } from "./NutrientDetailScreen";
import NutrientTimingChart from "../components/NutrientTimingChart";
import { staggerStyle } from "../lib/stagger";

// Reached by tapping a day row in NutrientDetailScreen's history list — a
// single date's drill-in, modeled on that same screen's own "X Today"
// section (Today/Past-Week/Past-Month progress bars, Active Goal, All
// Contributors), just generalized from always-"today" to whatever date was
// tapped, plus a new Nutrient Timing hourly chart. Nutrient Completeness
// (the MacroFactor reference screenshot's blue score circle) is deliberately
// not included — see CLAUDE.md/this session's notes on why it can't be
// computed correctly yet (core macro columns are NOT NULL with no
// real-vs-missing signal).
export default function NutrientDayDetailScreen() {
  const navigate = useNavigate();
  const { metric, date } = useParams<{ metric: string; date: string }>();
  const metricId: MetricId = metric && metric in METRIC_CONFIG ? (metric as MetricId) : "calories";
  const config = METRIC_CONFIG[metricId];
  const viewDate = date ?? "";

  const { unit: energyUnit } = useEnergyUnit();
  const fullHistory = useLogsHistory(3650);
  const programs = usePrograms();
  const dayLog = useDayLog(viewDate);

  const programList = programs.data ?? [];
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: config.decimals, minimumFractionDigits: config.decimals });
  const convert = (n: number) => (metricId === "calories" ? kcalToUnit(n, energyUnit) : n);
  const unitLabel = metricId === "calories" ? energyUnitLabel(energyUnit) : config.unit;

  const windows = computeNutrientWindowStats(fullHistory.data ?? [], programList, viewDate, metricId, config.targetKey);
  const targetsForDay = targetsForDate(programList, viewDate);
  const targetForDay = targetsForDay ? targetsForDay[config.targetKey] : null;
  const contributors = topContributors(dayLog.data?.entries ?? [], metricId, 999);

  const rows: { label: string; stat: (typeof windows)["day"] }[] = [
    { label: formatDayLabel(viewDate), stat: windows.day },
    { label: "Past Week", stat: windows.week },
    { label: "Past Month", stat: windows.month },
  ];

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3 flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-ink active:bg-white/10"
        >
          <ChevronLeft size={20} strokeWidth={2.2} />
        </button>
        <h1 className="flex-1 text-lg font-medium text-center truncate">{config.label}</h1>
        <div className="h-9 w-9 shrink-0" />
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(0, 60, 5)}>
          {rows.map((r) => (
            <div key={r.label} className="px-4 py-3 border-b border-line/60 last:border-b-0">
              <div className="flex items-center justify-between text-sm gap-2">
                <span className="shrink-0">{r.label}</span>
                <span className="tabular truncate">
                  {fmt(convert(r.stat.actual))}
                  {r.stat.target !== null ? ` / ${fmt(convert(r.stat.target))}` : ""} {unitLabel}
                  {r.stat.pct !== null && <span className="text-muted ml-2">{r.stat.pct}%</span>}
                </span>
              </div>
              <div className="h-1.5 bg-surface-raised rounded-full mt-1.5 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(100, r.stat.pct ?? 0)}%`, background: config.color }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="tile-enter" style={staggerStyle(1, 60, 5)}>
          <p className="text-[11px] tracking-widest uppercase text-muted px-1 pb-2">Active Goal</p>
          <div className="border border-line bg-surface rounded-2xl p-4">
            <p className="text-sm font-semibold">Target</p>
            <p className="text-xs text-muted mt-0.5">Set According to Your Strategy</p>
            <p className="tabular text-lg font-medium tracking-tight mt-2">
              {targetForDay !== null ? `${fmt(convert(targetForDay))} ${unitLabel}` : "—"}
            </p>
          </div>
        </div>

        {contributors.length > 0 && (
          <div className="tile-enter" style={staggerStyle(2, 60, 5)}>
            <p className="text-[11px] tracking-widest uppercase text-muted px-1 pb-2">All Contributors</p>
            <div className="border border-line bg-surface rounded-2xl overflow-hidden">
              {contributors.map((c) => (
                <div key={c.foodId} className="flex items-center justify-between px-4 py-2.5 border-b border-line/60 last:border-b-0">
                  <span className="text-sm truncate pr-2">{c.name}</span>
                  <span className="tabular text-sm shrink-0">
                    {fmt(convert(c.amount))} {unitLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="tile-enter" style={staggerStyle(3, 60, 5)}>
          <p className="text-[11px] tracking-widest uppercase text-muted px-1 pb-2">Nutrient Timing</p>
          <div className="border border-line bg-surface rounded-2xl py-3">
            <NutrientTimingChart entries={dayLog.data?.entries ?? []} metric={metricId} color={config.color} unit={unitLabel} />
          </div>
        </div>
      </main>
    </div>
  );
}
