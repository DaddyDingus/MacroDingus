import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { LogEntry } from "../api/types";
import { hourFromLoggedAt } from "../lib/date";
import { GRID, MUTED } from "../lib/chartLayout";

// 5AM through 11PM — same fixed hourly range MacroFactor's own Nutrient
// Timing chart uses, not a data-driven min/max (an empty late-night hour is
// still meaningful context, not something to collapse away).
const HOURS = Array.from({ length: 19 }, (_, i) => i + 5);

function hourLabel(hour: number): string {
  const h = hour % 12 || 12;
  return `${h}${hour < 12 || hour === 24 ? "AM" : "PM"}`;
}

function CustomTooltip({ active, payload, unit }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  if (point.value <= 0) return null;
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{point.label}</p>
      <p className="tabular text-ink">
        {point.value} {unit}
      </p>
    </div>
  );
}

// Bold "share of the day's total" label above each non-empty bar, matching
// MacroFactor's own Nutrient Timing chart. `total` is closed over rather
// than looked up per-bar since it's the same one number (the day's full
// sum) for every bar.
function renderShareLabel(total: number) {
  return (props: any) => {
    const { x, y, width, value } = props;
    if (!value || value <= 0 || total <= 0) return null;
    const pct = Math.round((value / total) * 100);
    return (
      <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
        {pct}%
      </text>
    );
  };
}

// One bar per hour of the day, summing a single nutrient metric across
// however many entries were logged in that hour — the per-nutrient sibling
// of MacroTimingChart's stacked P/F/C version. `entries` should already be
// scoped to the one day being viewed (useDayLog(date)), not full history.
export default function NutrientTimingChart({
  entries,
  metric,
  color,
  unit,
}: {
  entries: LogEntry[];
  metric: "calories" | "protein" | "carbs" | "fat";
  color: string;
  unit: string;
}) {
  const byHour = new Map<number, number>();
  for (const e of entries) {
    const hour = hourFromLoggedAt(e.loggedAt);
    byHour.set(hour, (byHour.get(hour) ?? 0) + e.nutrition[metric]);
  }
  const data = HOURS.map((hour) => ({
    hour,
    label: hourLabel(hour),
    value: Math.round((byHour.get(hour) ?? 0) * 10) / 10,
  }));
  const hasAny = data.some((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  if (!hasAny) {
    return (
      <div className="h-[180px] flex items-center justify-center">
        <p className="text-sm text-muted">No entries logged this day.</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 20, right: 4, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: MUTED, fontSize: 9 }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          interval={0}
          // Flat horizontal labels (even shrunk down and packed edge-to-edge)
          // still overlapped at 19 categories on a real phone width — a
          // vertical label's horizontal footprint is just its font size, not
          // its text length, which is the only way to guarantee zero overlap
          // regardless of viewport width without dropping some hours.
          angle={-90}
          textAnchor="end"
          height={50}
        />
        <YAxis hide domain={[0, "dataMax"]} />
        <Tooltip content={<CustomTooltip unit={unit} />} cursor={{ fill: GRID, opacity: 0.3 }} />
        <Bar dataKey="value" radius={[2, 2, 0, 0]} maxBarSize={14} label={renderShareLabel(total) as any}>
          {data.map((d) => (
            <Cell key={d.hour} fill={color} fillOpacity={d.value > 0 ? 1 : 0} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
