import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { LogEntry } from "../api/types";
import { hourFromLoggedAt } from "../lib/date";
import { GRID, MUTED } from "../lib/chartLayout";

// Same three colors as MacroHistoryChart/MacroSummaryBar (tailwind.config.js).
const PROTEIN = "#EF8D6A";
const CARBS = "#5ABC80";
const FAT = "#F7D372";

const HOURS = Array.from({ length: 19 }, (_, i) => i + 5);

function hourLabel(hour: number): string {
  const h = hour % 12 || 12;
  return `${h}${hour < 12 || hour === 24 ? "AM" : "PM"}`;
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum: number, p: any) => sum + p.value, 0);
  if (total <= 0) return null;
  const rows = [
    { key: "proteinKcal", color: PROTEIN, name: "Protein" },
    { key: "carbsKcal", color: CARBS, name: "Carbs" },
    { key: "fatKcal", color: FAT, name: "Fat" },
  ];
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{label}</p>
      {rows.map((r) => {
        const entry = payload.find((p: any) => p.dataKey === r.key);
        if (!entry || entry.value <= 0) return null;
        return (
          <p key={r.key} className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: r.color }} />
            <span className="tabular text-ink">{entry.value} kcal</span>
            <span className="text-muted">{r.name}</span>
          </p>
        );
      })}
    </div>
  );
}

// Stacked-by-calorie-contribution hourly bars — same convention as
// MacroHistoryChart's daily version (protein/carbs *4, fat *9), just bucketed
// by hour of day for a single date instead of by date across a range.
// `entries` should already be scoped to the one day being viewed.
export default function MacroTimingChart({ entries }: { entries: LogEntry[] }) {
  const byHour = new Map<number, { proteinKcal: number; carbsKcal: number; fatKcal: number }>();
  for (const e of entries) {
    const hour = hourFromLoggedAt(e.loggedAt);
    const bucket = byHour.get(hour) ?? { proteinKcal: 0, carbsKcal: 0, fatKcal: 0 };
    bucket.proteinKcal += e.nutrition.protein * 4;
    bucket.carbsKcal += e.nutrition.carbs * 4;
    bucket.fatKcal += e.nutrition.fat * 9;
    byHour.set(hour, bucket);
  }
  const data = HOURS.map((hour) => {
    const b = byHour.get(hour);
    return {
      hour,
      label: hourLabel(hour),
      proteinKcal: Math.round(b?.proteinKcal ?? 0),
      carbsKcal: Math.round(b?.carbsKcal ?? 0),
      fatKcal: Math.round(b?.fatKcal ?? 0),
    };
  });
  const hasAny = data.some((d) => d.proteinKcal + d.carbsKcal + d.fatKcal > 0);

  if (!hasAny) {
    return (
      <div className="h-[180px] flex items-center justify-center">
        <p className="text-sm text-muted">No entries logged this day.</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
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
        <Tooltip content={<CustomTooltip />} cursor={{ fill: GRID, opacity: 0.3 }} />
        <Bar dataKey="carbsKcal" stackId="cal" fill={CARBS} maxBarSize={14} />
        <Bar dataKey="fatKcal" stackId="cal" fill={FAT} maxBarSize={14} />
        <Bar dataKey="proteinKcal" stackId="cal" fill={PROTEIN} maxBarSize={14} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
