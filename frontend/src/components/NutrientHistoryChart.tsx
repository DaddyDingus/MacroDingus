import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const GRID = "#33373E";
const MUTED = "#8A8F98";

function formatShortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return new Date(2000, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function CustomTooltip({ active, payload, label, color, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{formatShortDate(label)}</p>
      <p className="flex items-center gap-2">
        <span className="inline-block w-3 h-[2px]" style={{ background: color }} />
        <span className="tabular text-ink">
          {Math.round(payload[0].value)} {unit}
        </span>
      </p>
    </div>
  );
}

export default function NutrientHistoryChart({
  data,
  color,
  unit,
}: {
  data: { date: string; value: number }[];
  color: string;
  unit: string;
}) {
  const hasData = data.some((d) => d.value > 0);
  if (!hasData) {
    return (
      <div className="h-[220px] flex items-center justify-center">
        <p className="text-sm text-muted">Log some food to see your history.</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatShortDate}
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          domain={([, dataMax]: [number, number]) => [0, dataMax * 1.15]}
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))}
        />
        <Tooltip content={<CustomTooltip color={color} unit={unit} />} cursor={{ stroke: GRID }} />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          activeDot={{ r: 4, fill: color }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
