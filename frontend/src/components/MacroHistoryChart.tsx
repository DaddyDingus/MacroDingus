import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { DayHistory } from "../api/logs";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import { dayIndex } from "../lib/date";
import { CHART_MARGIN, GRID, MUTED, formatShortTs } from "../lib/chartLayout";

// Same three colors as the rest of the app (MacroSummaryBar, quantity
// preview) — see tailwind.config.js for the palette note. "Other"
// reuses the `calories` blue rather than introducing a new named token —
// it's fundamentally a residual-energy bucket, and blue is already this
// app's calories/energy identity color everywhere else.
const PROTEIN = "#EF8D6A";
const CARBS = "#5ABC80";
const FAT = "#F7D372";
const OTHER = "#749EF4";

// Stacked by calorie contribution (protein/carbs *4, fat *9), not raw grams —
// grams alone would visually understate fat's share of the day's energy.
// "Other" is the residual: whatever of the day's total calories isn't
// explained by protein+carbs+fat at their standard kcal/g factors (e.g.
// sugar alcohols, fiber counted differently, or a food logged with only a
// calorie value and no macro breakdown) — a real, derived-from-actual-data
// number, not a fabricated one, and clamped at 0 since rounding can
// otherwise nudge it a hair negative.
function toChartData(history: DayHistory[], unit: ReturnType<typeof useEnergyUnit>["unit"]) {
  return history.map((d) => {
    const proteinKcal = d.protein * 4;
    const carbsKcal = d.carbs * 4;
    const fatKcal = d.fat * 9;
    const otherKcal = Math.max(0, d.calories - proteinKcal - carbsKcal - fatKcal);
    return {
      ts: dayIndex(d.date),
      proteinKcal: Math.round(kcalToUnit(proteinKcal, unit)),
      carbsKcal: Math.round(kcalToUnit(carbsKcal, unit)),
      fatKcal: Math.round(kcalToUnit(fatKcal, unit)),
      otherKcal: Math.round(kcalToUnit(otherKcal, unit)),
    };
  });
}

function CustomTooltip({ active, payload, label }: any) {
  const { unit } = useEnergyUnit();
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum: number, p: any) => sum + p.value, 0);
  const rows = [
    { key: "proteinKcal", color: PROTEIN, name: "Protein" },
    { key: "carbsKcal", color: CARBS, name: "Carbs" },
    { key: "fatKcal", color: FAT, name: "Fat" },
    { key: "otherKcal", color: OTHER, name: "Other" },
  ];
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{formatShortTs(label)}</p>
      {rows.map((r) => {
        const entry = payload.find((p: any) => p.dataKey === r.key);
        if (!entry) return null;
        return (
          <p key={r.key} className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: r.color }} />
            <span className="tabular text-ink">
              {entry.value} {energyUnitLabel(unit)}
            </span>
            <span className="text-muted">{r.name}</span>
          </p>
        );
      })}
      <p className="tabular text-ink mt-1 pt-1 border-t border-line">
        {total} {energyUnitLabel(unit)} total
      </p>
    </div>
  );
}

// Split out from the chart itself so the screen can place it in ChartCard's
// legend slot below the RangeToggle, matching every other history chart's
// layout (see chartLayout.ts).
export function MacroHistoryChartLegend() {
  return (
    <>
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
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: OTHER }} />
        Other
      </span>
    </>
  );
}

export default function MacroHistoryChart({
  history,
  hasData,
  windowStart,
  windowEnd,
  height,
}: {
  history: DayHistory[]; // already windowed to [windowStart, windowEnd] by the caller
  hasData: boolean; // whether there's ANY logged macro data at all, independent of the current window
  windowStart: number;
  windowEnd: number;
  height: number;
}) {
  const { unit: energyUnit } = useEnergyUnit();
  const data = toChartData(history, energyUnit);

  if (!hasData) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-sm text-muted">Log some food to see your macro history.</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          type="number"
          dataKey="ts"
          domain={[windowStart, windowEnd]}
          allowDataOverflow
          tickFormatter={formatShortTs}
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
        <Bar dataKey="carbsKcal" stackId="cal" fill={CARBS} maxBarSize={20} isAnimationActive={false} />
        <Bar dataKey="fatKcal" stackId="cal" fill={FAT} maxBarSize={20} isAnimationActive={false} />
        <Bar dataKey="proteinKcal" stackId="cal" fill={PROTEIN} maxBarSize={20} isAnimationActive={false} />
        <Bar
          dataKey="otherKcal"
          stackId="cal"
          fill={OTHER}
          maxBarSize={20}
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
