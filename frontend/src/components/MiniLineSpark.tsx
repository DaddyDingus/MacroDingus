import { LineChart, Line, ResponsiveContainer } from "recharts";

// Same accent used everywhere else a single continuous series is drawn
// (WeightChart's trend line) — one hue, thin 2px line, no axes/grid/legend.
const ACCENT = "#6BE4C0";

export default function MiniLineSpark({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <div className="h-full flex items-center text-[11px] text-muted">Not enough data yet</div>;
  }
  const data = values.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
