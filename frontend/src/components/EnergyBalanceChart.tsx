import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { DayHistory } from "../api/logs";
import type { Checkin } from "../api/coach";
import { activeCheckinForDate } from "../lib/checkins";

// "Calories in" reuses the same blue calories are drawn in everywhere else
// (Dashboard's totals card, the Calories nutrient tile); "calories out"
// reuses the same orange TDEE/expenditure is drawn in everywhere else
// (TdeeChart, the Expenditure tile). Two series, one shared kcal axis — not
// a dual-axis chart, just two lines on one scale.
const IN = "#3987E5";
const OUT = "#D95926";
const GRID = "#33373E";
const MUTED = "#8A8F98";

function formatShortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return new Date(2000, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const inEntry = payload.find((p: any) => p.dataKey === "caloriesIn");
  const outEntry = payload.find((p: any) => p.dataKey === "caloriesOut");
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{formatShortDate(label)}</p>
      {inEntry && (
        <p className="flex items-center gap-2">
          <span className="inline-block w-3 h-[2px]" style={{ background: IN }} />
          <span className="tabular text-ink">{Math.round(inEntry.value)} kcal</span>
          <span className="text-muted">in</span>
        </p>
      )}
      {outEntry != null && outEntry.value != null && (
        <p className="flex items-center gap-2 mt-0.5">
          <span className="inline-block w-3 h-[2px]" style={{ background: OUT }} />
          <span className="tabular text-ink">{Math.round(outEntry.value)} kcal</span>
          <span className="text-muted">out</span>
        </p>
      )}
    </div>
  );
}

export default function EnergyBalanceChart({ history, checkins }: { history: DayHistory[]; checkins: Checkin[] }) {
  const data = history.map((d) => {
    const active = activeCheckinForDate(checkins, d.date);
    return { date: d.date, caloriesIn: Math.round(d.calories), caloriesOut: active ? Math.round(active.tdee) : null };
  });
  const hasOut = data.some((d) => d.caloriesOut !== null);

  if (!hasOut) {
    return (
      <div className="h-[220px] flex items-center justify-center">
        <p className="text-sm text-muted">Check in at least once to see your energy balance.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 px-1 pb-2">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block w-3 h-[2px]" style={{ background: IN }} />
          Calories in
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block w-3 h-[2px]" style={{ background: OUT }} />
          Calories out
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
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
            domain={["dataMin - 200", "dataMax + 200"]}
            tick={{ fill: MUTED, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: GRID }} />
          <Line type="monotone" dataKey="caloriesIn" stroke={IN} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, fill: IN }} />
          <Line type="monotone" dataKey="caloriesOut" stroke={OUT} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, fill: OUT }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
