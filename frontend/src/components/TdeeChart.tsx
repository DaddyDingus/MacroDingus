import { useMemo } from "react";
import { LineChart } from "lucide-react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { DailyExpenditurePoint } from "../api/coach";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import { dayIndex, dateFromDayIndex } from "../lib/date";
import { CHART_MARGIN, GRID, MUTED, formatShortTs, showPointDots } from "../lib/chartLayout";

// Exported alongside the layout constants below — ExpenditureChartCard's
// legend row needs the same color.
export const ACCENT = "#D95926";
// The "Holding" dot color — a muted version of ACCENT rather than MUTED
// grey, so it still reads as "this line" rather than an unrelated neutral
// marker (matches MacroFactor's own Holding dot, a dimmer orange square).
export const HOLDING_COLOR = "#B8703F";

// Longer ranges plot fewer, wider points instead of one per day — a 1Y or
// All view at true daily resolution is hundreds of stepped dots and a
// jagged band crammed into ~350px, which reads as noise rather than a
// trend. Auto-picked from the visible window's own width (not the preset
// pill), so panning/pinching past a threshold changes it too, same as every
// other range-driven behavior on this chart. Deliberately not a manual
// control (MacroFactor has one) — picking a sensible default per range
// covers the same need without a fourth piece of UI to manage.
type BucketUnit = "day" | "week" | "month";
function bucketUnitFor(windowDays: number): BucketUnit {
  if (windowDays <= 90) return "day";
  if (windowDays <= 365) return "week";
  return "month";
}

function firstOfMonthTs(ts: number): number {
  const [y, m] = dateFromDayIndex(ts).split("-");
  return dayIndex(`${y}-${m}-01`);
}

interface ChartRow {
  ts: number;
  tdee?: number;
  isReal: boolean;
  low?: number;
  band?: number;
  fluxKcal?: number;
  bucketEndTs?: number;
}

// Averages each bucket's tdee (and, separately, its low/band/fluxKcal) over
// only the days within it that actually have a value — a bucket with zero
// flux-covered days still has none after aggregating, same "don't fabricate
// a value" rule the daily build already follows. Week buckets anchor to
// `windowStart` rather than the calendar week (avoids ISO-week edge cases
// for no real benefit here); month buckets anchor to the calendar month
// since "the week of Jul 9" doesn't mean much but "July" does.
function aggregateChartData(daily: ChartRow[], unit: BucketUnit, windowStart: number): ChartRow[] {
  if (unit === "day") return daily;
  const buckets = new Map<number, ChartRow[]>();
  for (const row of daily) {
    const bucketTs =
      unit === "week" ? windowStart + Math.floor((row.ts - windowStart) / 7) * 7 : firstOfMonthTs(row.ts);
    if (!buckets.has(bucketTs)) buckets.set(bucketTs, []);
    buckets.get(bucketTs)!.push(row);
  }
  const avg = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length;
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, rows]) => {
      const tdeeVals = rows.map((r) => r.tdee).filter((v): v is number => v !== undefined);
      const fluxRows = rows.filter((r) => r.low !== undefined && r.band !== undefined);
      return {
        ts,
        tdee: tdeeVals.length ? avg(tdeeVals) : undefined,
        isReal: true, // dots are never shown beyond 1M zoom anyway (see showPointDots), where bucketing kicks in
        low: fluxRows.length ? avg(fluxRows.map((r) => r.low!)) : undefined,
        band: fluxRows.length ? avg(fluxRows.map((r) => r.band!)) : undefined,
        fluxKcal: fluxRows.length ? avg(fluxRows.map((r) => r.fluxKcal!)) : undefined,
        bucketEndTs: rows[rows.length - 1].ts,
      };
    });
}

function CustomTooltip({ active, payload, label, showFlux }: any) {
  const { unit } = useEnergyUnit();
  if (!active || !payload?.length) return null;
  const tdeePoint = payload.find((p: any) => p.dataKey === "tdee");
  if (!tdeePoint) return null;
  const isReal = tdeePoint.payload?.isReal;
  const fluxPoint = payload.find((p: any) => p.payload?.fluxKcal !== undefined);
  const flux = fluxPoint?.payload?.fluxKcal;
  const bucketEndTs = tdeePoint.payload?.bucketEndTs;
  const dateLabel =
    bucketEndTs !== undefined && bucketEndTs !== label
      ? `${formatShortTs(label)} – ${formatShortTs(bucketEndTs)}`
      : formatShortTs(label);
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{dateLabel}</p>
      <p className="flex items-center gap-2">
        <span className="inline-block w-3 h-[2px]" style={{ background: isReal ? ACCENT : HOLDING_COLOR }} />
        <span className="tabular text-ink">
          {Math.round(tdeePoint.value)} {energyUnitLabel(unit)}
        </span>
        <span className="text-muted">{isReal ? "Expenditure" : "Holding"}</span>
      </p>
      {showFlux && flux !== undefined && (
        <p className="tabular text-muted mt-0.5">
          ± {Math.round(flux)} {energyUnitLabel(unit)} flux
        </p>
      )}
    </div>
  );
}

// A filled circle on a day the adaptive engine produced a fresh estimate
// ("Expenditure"), a small hollow square on a day it didn't and the line is
// just holding the last real value forward ("Holding") — mirrors
// MacroFactor's own two-marker-style single line exactly, chosen instead of
// two separately-colored lines (a held-forward value isn't a different
// *series*, just a different *confidence* in the same one).
function TdeeDot(props: any) {
  const { cx, cy, payload, index } = props;
  if (payload?.tdee === undefined) return <g key={`empty-${index}`} />;
  if (payload.isReal) return <circle key={`dot-${index}`} cx={cx} cy={cy} r={3} fill={ACCENT} />;
  return (
    <rect
      key={`dot-${index}`}
      x={cx - 2.5}
      y={cy - 2.5}
      width={5}
      height={5}
      fill="none"
      stroke={HOLDING_COLOR}
      strokeWidth={1.5}
    />
  );
}

// The expand/collapse chevron, height transition, and gesture overlay are
// owned by ChartCard (shared across every history chart) — this component
// only ever renders the Recharts tree itself for whatever window/height
// ChartCard hands it.
export default function TdeeChart({
  dailyFlux,
  windowStart,
  windowEnd,
  height,
  showFlux,
}: {
  // A day-by-day backfill (GET /api/coach/expenditure-daily) that re-runs
  // the same adaptive TDEE engine as-of every day the engine had enough
  // trailing data for — one row per day with a real estimate, gaps
  // everywhere else. This is now the chart's sole data source (see
  // ChartRow.isReal below); a separate check-in snapshot no longer drives
  // the line, matching how MacroFactor's own Expenditure/Holding legend has
  // no third "check-in" concept at all.
  dailyFlux: DailyExpenditurePoint[];
  windowStart: number;
  windowEnd: number;
  height: number;
  showFlux: boolean;
}) {
  const { unit: energyUnit } = useEnergyUnit();

  const dailyAsc = useMemo(
    () =>
      [...dailyFlux]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((p) => ({ ts: dayIndex(p.date), tdee: p.tdee, fluxKcal: p.fluxKcal })),
    [dailyFlux]
  );

  // One row per day across the visible window, shared by both the Line and
  // the Area — Recharts' `stackId` stacking (used for the band) computes its
  // stack groups off the chart's own top-level `data`, and silently renders
  // nothing at all if each series instead supplies its own separate `data`
  // array (which is what an earlier, broken version of this component did).
  // Both `tdee` AND `fluxKcal` are held forward from the last real daily
  // estimate on a day the engine has no fresh one for — not just tdee — so
  // the Flux Range band stays visually continuous through a "Holding"
  // stretch instead of vanishing the moment data gets sparse, matching
  // MacroFactor's own screenshot (the shaded band runs the full width even
  // where the line switches to hollow-square Holding markers).
  const windowDays = windowEnd - windowStart + 1;
  const bucketUnit = bucketUnitFor(windowDays);

  const chartData = useMemo(() => {
    const rows: ChartRow[] = [];
    let holdIdx = -1;
    for (let ts = windowStart; ts <= windowEnd; ts++) {
      while (holdIdx + 1 < dailyAsc.length && dailyAsc[holdIdx + 1].ts <= ts) holdIdx++;
      const holding = holdIdx >= 0 ? dailyAsc[holdIdx] : undefined;
      const isReal = holding !== undefined && holding.ts === ts;
      const holdingTdee = holding !== undefined ? Math.round(kcalToUnit(holding.tdee, energyUnit)) : undefined;
      const flux = holding !== undefined ? kcalToUnit(holding.fluxKcal, energyUnit) : undefined;
      rows.push({
        ts,
        tdee: holdingTdee,
        isReal,
        low: holdingTdee !== undefined && flux !== undefined ? holdingTdee - flux : undefined,
        band: holdingTdee !== undefined && flux !== undefined ? flux * 2 : undefined,
        fluxKcal: flux !== undefined ? Math.round(flux) : undefined,
      });
    }
    return aggregateChartData(rows, bucketUnit, windowStart);
  }, [dailyAsc, windowStart, windowEnd, energyUnit, bucketUnit]);

  if (dailyAsc.length === 0) {
    return (
      <div className="relative flex flex-col items-center justify-center gap-2" style={{ height }}>
        {/* Ghost of the real chart: faint gridlines + a dashed placeholder
            trend, so the empty state reads as "this space is reserved for
            your chart" rather than a blank box. Non-scaling-stroke keeps the
            dashed line's width consistent despite the viewBox being
            stretched non-uniformly by preserveAspectRatio="none". */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line x1="0" y1="25" x2="100" y2="25" stroke={GRID} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="50" x2="100" y2="50" stroke={GRID} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="75" x2="100" y2="75" stroke={GRID} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <polyline
            points="0,68 16,58 32,62 48,42 64,48 80,30 100,36"
            fill="none"
            stroke={MUTED}
            strokeWidth="1.5"
            strokeOpacity="0.35"
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <LineChart className="relative w-6 h-6 text-muted opacity-30" strokeWidth={1.5} />
        <p className="relative text-sm text-muted text-center px-8">Keep weighing in and logging to see a trend.</p>
      </div>
    );
  }

  const visibleValues: number[] = [];
  for (const d of chartData) {
    if (d.tdee !== undefined) visibleValues.push(d.tdee);
    if (showFlux && d.low !== undefined && d.band !== undefined) visibleValues.push(d.low, d.low + d.band);
  }
  const pad = kcalToUnit(100, energyUnit);
  const domain: [number, number] = visibleValues.length
    ? [Math.min(...visibleValues) - pad, Math.max(...visibleValues) + pad]
    : [0, kcalToUnit(3000, energyUnit)];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={CHART_MARGIN}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          type="number"
          dataKey="ts"
          domain={[windowStart, windowEnd]}
          allowDataOverflow
          tickFormatter={formatShortTs}
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          domain={domain}
          allowDataOverflow
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
        />
        <Tooltip content={<CustomTooltip showFlux={showFlux} />} cursor={{ stroke: GRID }} />
        {showFlux && (
          <>
            {/* monotone, not stepAfter — purely cosmetic: the band's edges
                step day-to-day since it's built from a real daily value,
                and at that granularity stepAfter reads as jagged rather
                than as a meaningful "holds until X" shape (unlike the
                bold TDEE line below, which deliberately keeps stepAfter
                since each of its steps IS a real held value). Smooths the
                curve through the same exact low/band numbers — no data
                changes, just how the line between real points is drawn. */}
            <Area type="monotone" dataKey="low" stackId="flux" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area
              type="monotone"
              dataKey="band"
              stackId="flux"
              stroke="none"
              fill={ACCENT}
              fillOpacity={0.15}
              isAnimationActive={false}
            />
          </>
        )}
        <Line
          // stepAfter only at true daily resolution, where each point is
          // a real "holds until the next estimate" value — once buckets
          // are weekly/monthly averages, a step misrepresents them as
          // discrete jumps instead of smoothed trend points.
          type={bucketUnit === "day" ? "stepAfter" : "monotone"}
          dataKey="tdee"
          stroke={ACCENT}
          strokeWidth={2}
          // Only dots at 1W/1M zoom (see chartLayout.ts's showPointDots) —
          // past that, every chart in the app goes bare-line-only.
          dot={showPointDots(windowDays) ? <TdeeDot /> : false}
          isAnimationActive={false}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
