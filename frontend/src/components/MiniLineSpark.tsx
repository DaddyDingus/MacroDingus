import { ComposedChart, Line, Area, XAxis, YAxis, ResponsiveContainer } from "recharts";

// Caller passes the same hue that metric/tile is drawn in everywhere else
// (e.g. the weight-purple in WeightChart, the calories-blue in the totals
// card) — this used to be one hardcoded accent color for every tile
// regardless of what it represented, which is why every nutrient sparkline
// on the Dashboard looked identical no matter which macro it was.
const DEFAULT_COLOR = "#D896FF";

// A sparkline must tightly fit its own data range, not a zero baseline —
// without an explicit domain, recharts' default made small-but-real ranges
// (e.g. 81-83kg) look pixel-flat next to a domain sized for the data's
// magnitude rather than its spread. This is reused across very different
// scales (kg deltas of ~0.1-3 vs TDEE values in the thousands), so the pad
// is relative to the data's own range rather than a fixed offset. A
// genuinely flat series (range === 0, e.g. two identical check-ins) still
// renders flat — it gets a small pad off the value itself, not stretched.
function sparkDomain([dataMin, dataMax]: [number, number]): [number, number] {
  const range = dataMax - dataMin;
  const pad = range > 0 ? range * 0.15 : Math.max(Math.abs(dataMax) * 0.02, 0.5);
  return [dataMin - pad, dataMax + pad];
}

export interface MiniSparkBandPoint {
  low: number;
  high: number;
}

export default function MiniLineSpark({
  values,
  color = DEFAULT_COLOR,
  showDots = false,
  band,
}: {
  values: number[];
  color?: string;
  showDots?: boolean;
  // Optional, index-aligned with `values` — a shaded range behind the line
  // (e.g. the Expenditure tile's Flux Range). `null` at an index means "no
  // band for this point," a real gap rather than a fabricated one, same
  // convention as TdeeChart's own flux band. Every other tile that reuses
  // this component simply omits the prop and renders exactly as before.
  band?: (MiniSparkBandPoint | null)[];
}) {
  if (values.length < 2) {
    return (
      <div className="h-full flex items-center text-[11px] text-muted whitespace-nowrap overflow-hidden text-ellipsis">
        Not enough data yet
      </div>
    );
  }
  const data = values.map((v, i) => {
    const b = band?.[i];
    return { i, v, low: b?.low, bandWidth: b ? b.high - b.low : undefined };
  });
  // Computed from `values` alone, not left to Recharts' own auto dataMin/Max
  // (the function form of `domain`, `([dataMin,dataMax]) => ...`, receives
  // extremes pooled across every series on this axis) — once a band exists,
  // its low/high easily span a much wider range than the line's own tight
  // values, and letting the axis stretch to fit both made the line itself
  // read as flat (a ~2600-2700 line squashed inside a ~2470-2830 domain
  // sized for the band). The line is the primary signal a sparkline exists
  // to show; the band is secondary and can simply run past the plotted edge
  // (Recharts clips it) rather than dictate the scale.
  const domain = sparkDomain([Math.min(...values), Math.max(...values)]);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
        {/* Hidden but required: without a declared XAxis, Recharts has no
            explicit x-reference to correlate the two stacked Area series
            against (see TdeeChart.tsx's Flux Range comment for the same
            class of stacking bug, hit there via a different cause). A plain
            unstacked Line alone never needed this, which is why every other
            sparkline in the app worked fine without one. */}
        <XAxis dataKey="i" hide />
        <YAxis hide domain={domain} allowDataOverflow />
        {band && (
          <>
            <Area type="monotone" dataKey="low" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area
              type="monotone"
              dataKey="bandWidth"
              stackId="band"
              stroke="none"
              fill={color}
              // Higher than TdeeChart's full-size 0.15 — confirmed via a real
              // headless-browser screenshot that 0.15 renders correctly but
              // is nearly imperceptible on a tile this small (a thin sliver,
              // often just 1-2 of 7 points wide). A bigger canvas can afford
              // subtlety; this one needs to read at a glance.
              fillOpacity={0.35}
              isAnimationActive={false}
            />
          </>
        )}
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          dot={showDots ? { r: 2.5, fill: color, strokeWidth: 0 } : false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
