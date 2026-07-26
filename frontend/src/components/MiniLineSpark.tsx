import { LineChart, Line, YAxis, ResponsiveContainer } from "recharts";

// Caller passes the same hue that metric/tile is drawn in everywhere else
// (e.g. the weight-purple in WeightChart, the calories-blue in the totals
// card) — this used to be one hardcoded teal for every tile regardless of
// what it represented, which is why every nutrient sparkline on the
// Dashboard looked identical no matter which macro it was.
const DEFAULT_COLOR = "#6BE4C0";

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

export default function MiniLineSpark({
  values,
  color = DEFAULT_COLOR,
  showDots = false,
}: {
  values: number[];
  color?: string;
  showDots?: boolean;
}) {
  if (values.length < 2) {
    return <div className="h-full flex items-center text-[11px] text-muted">Not enough data yet</div>;
  }
  const data = values.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
        <YAxis hide domain={sparkDomain} />
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          dot={showDots ? { r: 2.5, fill: color, strokeWidth: 0 } : false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
