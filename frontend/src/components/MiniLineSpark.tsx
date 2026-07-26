import { LineChart, Line, YAxis, ResponsiveContainer } from "recharts";

// Same accent used everywhere else a single continuous series is drawn
// (WeightChart's trend line) — one hue, thin 2px line, no axes/grid/legend.
const ACCENT = "#6BE4C0";

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

export default function MiniLineSpark({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <div className="h-full flex items-center text-[11px] text-muted">Not enough data yet</div>;
  }
  const data = values.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <YAxis hide domain={sparkDomain} />
        <Line type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
