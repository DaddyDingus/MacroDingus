import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { TrendPoint } from "../api/weights";
import { kgToUnit, type WeightUnit } from "../lib/weightUnit";
import { dayIndex } from "../lib/date";
import { CHART_MARGIN, GRID, MUTED, formatShortTs, showPointDots } from "../lib/chartLayout";

const ACCENT = "#9085E9";
// A darker shade of ACCENT (same hue/saturation, ~60% of its brightness) —
// matches MacroFactor's own Trend/Scale Weight pairing, where Scale Weight
// reads as a deeper version of the trend line's color rather than a
// separate, unrelated grey.
const SCALE_COLOR = "#56508C";

function CustomTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  const trend = payload.find((p: any) => p.dataKey === "trendDisplay");
  const scale = payload.find((p: any) => p.dataKey === "weightDisplay");
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{formatShortTs(label)}</p>
      {trend && (
        <p className="flex items-center gap-2">
          <span className="inline-block w-3 h-[2px]" style={{ background: ACCENT }} />
          <span className="tabular text-ink">
            {trend.value.toFixed(1)} {unit}
          </span>
          <span className="text-muted">trend</span>
        </p>
      )}
      {scale?.value !== undefined && (
        <p className="flex items-center gap-2 mt-0.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: SCALE_COLOR }} />
          <span className="tabular text-ink">
            {scale.value.toFixed(1)} {unit}
          </span>
          <span className="text-muted">scale</span>
        </p>
      )}
    </div>
  );
}

// The Trend/Scale toggle chips — split out from the chart itself so the
// screen can place them in ChartCard's legend slot below the RangeToggle,
// matching every other history chart's layout (see chartLayout.ts).
export function WeightChartLegend({
  showTrend,
  showScale,
  onToggleTrend,
  onToggleScale,
}: {
  showTrend: boolean;
  showScale: boolean;
  onToggleTrend: () => void;
  onToggleScale: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggleTrend}
        className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
          showTrend ? "border-accent text-accent" : "border-line text-muted"
        }`}
      >
        <span className="inline-block w-3 h-[2px]" style={{ background: showTrend ? ACCENT : MUTED }} />
        Trend Weight
      </button>
      <button
        type="button"
        onClick={onToggleScale}
        className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
          showScale ? "border-accent text-accent" : "border-line text-muted"
        }`}
      >
        <span className="inline-block w-3 h-[2px]" style={{ background: showScale ? SCALE_COLOR : MUTED }} />
        Scale Weight
      </button>
    </>
  );
}

// Chevron, height transition, and gesture overlay live in ChartCard now —
// this only ever renders the Recharts tree for the window/height it's given.
export default function WeightChart({
  points,
  hasData,
  unit,
  showScale,
  showTrend,
  windowStart,
  windowEnd,
  height,
}: {
  points: TrendPoint[]; // already windowed to [windowStart, windowEnd] by the caller
  hasData: boolean; // whether there's ANY weigh-in at all, independent of the current window
  unit: WeightUnit;
  showScale: boolean;
  showTrend: boolean;
  windowStart: number;
  windowEnd: number;
  height: number;
}) {
  if (!hasData) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-sm text-muted">Log a weight to start seeing your trend.</p>
      </div>
    );
  }

  // weightDisplay is undefined on an implied (no real weigh-in) day — points
  // is dense now (one row per calendar day, see api/weights.ts's TrendPoint),
  // but Scale Weight must never render a fabricated reading for a day
  // nothing was actually logged. Recharts skips undefined slots when drawing
  // the line (see the Line's `connectNulls` below), so the rendered segment
  // still connects consecutive real readings directly, same as before this
  // densified.
  const data = points.map((p) => ({
    ts: dayIndex(p.date),
    weightDisplay: p.weightKg !== null ? Math.round(kgToUnit(p.weightKg, unit) * 10) / 10 : undefined,
    trendDisplay: Math.round(kgToUnit(p.trendKg, unit) * 10) / 10,
  }));

  // Domain is built only from whichever series is actually visible, rather
  // than recharts' "dataMin"/"dataMax" keywords (which read across every
  // dataKey present in `data` regardless of which Lines are mounted) — so
  // hiding a series via the legend chips actually tightens the axis instead
  // of leaving room for a line that isn't drawn.
  const visibleValues = data.flatMap((d) => {
    const vals: number[] = [];
    if (showScale && d.weightDisplay !== undefined) vals.push(d.weightDisplay);
    if (showTrend) vals.push(d.trendDisplay);
    return vals;
  });
  const domain: [number, number] = visibleValues.length
    ? [Math.floor(Math.min(...visibleValues) - 1), Math.ceil(Math.max(...visibleValues) + 1)]
    : [0, 1];

  // Trend Weight only dots at 1W/1M zoom (see chartLayout.ts's
  // showPointDots) — past that, daily dots overlap and read as noise. Scale
  // Weight never dots at all, at any zoom: it's the raw, already-noisy daily
  // series, so a permanent line (no per-point markers) reads as the "actual
  // readings" counterpart to Trend Weight's smoothed line, rather than
  // competing with it for attention via bouncing dots.
  const showTrendDots = showPointDots(windowEnd - windowStart + 1);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
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
          allowDecimals={false}
          tickFormatter={(v: number) => v.toFixed(0)}
        />
        <Tooltip content={<CustomTooltip unit={unit} />} cursor={{ stroke: GRID }} />
        {showScale && (
          <Line
            type="monotone"
            dataKey="weightDisplay"
            stroke={SCALE_COLOR}
            strokeWidth={1.5}
            dot={false}
            connectNulls
            isAnimationActive={false}
            activeDot={{ r: 4 }}
          />
        )}
        {showTrend && (
          <Line
            type="monotone"
            dataKey="trendDisplay"
            stroke={ACCENT}
            strokeWidth={2}
            dot={showTrendDots ? { r: 3, fill: ACCENT, strokeWidth: 0 } : false}
            isAnimationActive={false}
            activeDot={{ r: 4, fill: ACCENT }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
