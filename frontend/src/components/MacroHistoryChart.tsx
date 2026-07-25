import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { DayHistory } from "../api/logs";

// Same three colors as the rest of the app (DailyFactsPanel dots, quantity
// preview) — validated via the dataviz skill's palette validator as an
// all-pairs colorblind-safe triad. See tailwind.config.js for the full note.
const PROTEIN = "#D95926";
const CARBS = "#3987E5";
const FAT = "#199E70";
const GRID = "#33373E";
const MUTED = "#8A8F98";

function formatShortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return new Date(2000, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Stacked by calorie contribution (protein/carbs *4, fat *9), not raw grams —
// grams alone would visually understate fat's share of the day's energy.
function toChartData(history: DayHistory[]) {
  return history.map((d) => ({
    date: d.date,
    proteinKcal: Math.round(d.protein * 4),
    carbsKcal: Math.round(d.carbs * 4),
    fatKcal: Math.round(d.fat * 9),
  }));
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum: number, p: any) => sum + p.value, 0);
  const rows = [
    { key: "proteinKcal", color: PROTEIN, name: "Protein" },
    { key: "carbsKcal", color: CARBS, name: "Carbs" },
    { key: "fatKcal", color: FAT, name: "Fat" },
  ];
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{formatShortDate(label)}</p>
      {rows.map((r) => {
        const entry = payload.find((p: any) => p.dataKey === r.key);
        if (!entry) return null;
        return (
          <p key={r.key} className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: r.color }} />
            <span className="tabular text-ink">{entry.value} kcal</span>
            <span className="text-muted">{r.name}</span>
          </p>
        );
      })}
      <p className="tabular text-ink mt-1 pt-1 border-t border-line">{total} kcal total</p>
    </div>
  );
}

export default function MacroHistoryChart({ history }: { history: DayHistory[] }) {
  const data = toChartData(history);
  const hasData = data.some((d) => d.proteinKcal + d.carbsKcal + d.fatKcal > 0);

  if (!hasData) {
    return (
      <div className="h-[220px] flex items-center justify-center">
        <p className="text-sm text-muted">Log some food to see your macro history.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 px-1 pb-2">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: PROTEIN }} />
          Protein
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: CARBS }} />
          Carbs
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: FAT }} />
          Fat
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
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
            tick={{ fill: MUTED, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: GRID, opacity: 0.3 }} />
          <Bar dataKey="proteinKcal" stackId="cal" fill={PROTEIN} maxBarSize={20} isAnimationActive={false} />
          <Bar dataKey="carbsKcal" stackId="cal" fill={CARBS} maxBarSize={20} isAnimationActive={false} />
          <Bar
            dataKey="fatKcal"
            stackId="cal"
            fill={FAT}
            maxBarSize={20}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
