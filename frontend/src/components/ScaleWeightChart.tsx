import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { WeighIn } from "../api/weights";
import { kgToUnit, type WeightUnit } from "../lib/weightUnit";
import { dayIndex } from "../lib/date";
import { CHART_MARGIN, GRID, MUTED, formatShortTs, showPointDots } from "../lib/chartLayout";

// Matches the Dashboard's own "Scale weight" tile sparkline color
// (DashboardTileSections.tsx) — deliberately NOT WeightChart.tsx's SCALE_COLOR
// (the darker purple used for the Scale Weight series *inside* the combined
// Weight Trend chart, kept there so it still reads as a shade of Trend
// Weight's purple when the two share an axis). Standing alone on its own
// screen, Scale Weight instead matches wherever else in the app it's
// referenced independently — the Dashboard tile — rather than a color
// borrowed from Weight Trend.
const SCALE_COLOR = "#059669";

function CustomTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{formatShortTs(label)}</p>
      <p className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: SCALE_COLOR }} />
        <span className="tabular text-ink">
          {payload[0].value.toFixed(1)} {unit}
        </span>
      </p>
    </div>
  );
}

// Raw scale readings only — no trend line, no legend (nothing to toggle
// against a single series), unlike WeightChart. Dots at 1W/1M zoom (see
// chartLayout.ts's showPointDots), same rule as every other chart — but
// unlike WeightChart's own Scale Weight series (which stays permanently
// dot-free, even at 1W/1M, so it doesn't visually compete with Trend
// Weight's dots on the combined chart), this is the only series on the
// screen, so there's nothing for its dots to compete with. Matches
// MacroFactor's own split: no dots on Scale Weight next to Trend Weight, but
// dots on Scale Weight alone on its own screen.
export default function ScaleWeightChart({
  points,
  hasData,
  unit,
  windowStart,
  windowEnd,
  height,
}: {
  points: WeighIn[]; // already windowed to [windowStart, windowEnd] by the caller
  hasData: boolean; // whether there's ANY weigh-in at all, independent of the current window
  unit: WeightUnit;
  windowStart: number;
  windowEnd: number;
  height: number;
}) {
  if (!hasData) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-sm text-muted">Log a weight to start seeing your scale readings.</p>
      </div>
    );
  }

  const data = points.map((p) => ({
    ts: dayIndex(p.date),
    weightDisplay: Math.round(kgToUnit(p.weightKg, unit) * 10) / 10,
  }));
  const values = data.map((d) => d.weightDisplay);
  const domain: [number, number] = values.length ? [Math.min(...values) - 1, Math.max(...values) + 1] : [0, 1];

  const showDots = showPointDots(windowEnd - windowStart + 1);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={CHART_MARGIN}>
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
        <Line
          type="monotone"
          dataKey="weightDisplay"
          stroke={SCALE_COLOR}
          strokeWidth={1.5}
          dot={showDots ? { r: 3, fill: SCALE_COLOR, strokeWidth: 0 } : false}
          isAnimationActive={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
