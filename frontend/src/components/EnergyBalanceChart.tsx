import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import { dayIndex } from "../lib/date";
import { CHART_MARGIN, GRID, MUTED, formatShortTs } from "../lib/chartLayout";

// Calories reuses the same blue calories are drawn in everywhere else
// (Dashboard's totals card, the Calories nutrient tile). The compare series
// (expenditure or target) is passed in by the caller — orange for
// Expenditure, `fat`'s yellow reused for Targets (see tailwind.config.js's
// own note on reusing hexes for concepts that never appear side by side;
// a calorie target and a fat gram target never render on the same screen).
const IN = "#749EF4";

function CustomTooltip({ active, payload, label, compareLabel, compareColor }: any) {
  const { unit } = useEnergyUnit();
  if (!active || !payload?.length) return null;
  const caloriesEntry = payload.find((p: any) => p.dataKey === "calories");
  const compareEntry = payload.find((p: any) => p.dataKey === "compare");
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{formatShortTs(label)}</p>
      {caloriesEntry && (
        <p className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: IN }} />
          <span className="tabular text-ink">
            {Math.round(caloriesEntry.value)} {energyUnitLabel(unit)}
          </span>
          <span className="text-muted">Calories</span>
        </p>
      )}
      {compareEntry?.value != null && (
        <p className="flex items-center gap-2 mt-0.5">
          <span className="inline-block w-3 h-[2px]" style={{ background: compareColor }} />
          <span className="tabular text-ink">
            {Math.round(compareEntry.value)} {energyUnitLabel(unit)}
          </span>
          <span className="text-muted">{compareLabel}</span>
        </p>
      )}
    </div>
  );
}

// Split out from the chart itself so the screen can place it in ChartCard's
// legend slot below the RangeToggle, matching every other history chart's
// layout (see chartLayout.ts).
export function EnergyBalanceChartLegend({ compareLabel, compareColor }: { compareLabel: string; compareColor: string }) {
  return (
    <>
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: IN }} />
        Calories
      </span>
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <span className="inline-block w-3 h-[2px] border-t border-dashed" style={{ borderColor: compareColor }} />
        {compareLabel}
      </span>
    </>
  );
}

// Calories-in as bars (a day's total is a discrete, complete number, not a
// point on a continuous line) against a dashed step line for whichever
// series the caller is comparing against — expenditure or calorie target.
// The line is a step (type="stepAfter"), not interpolated, for the same
// reason TdeeChart's is: both expenditure and target calories hold constant
// between check-ins/profile edits rather than drifting smoothly.
export default function EnergyBalanceChart({
  data,
  compareLabel,
  compareColor,
  emptyMessage,
  windowStart,
  windowEnd,
  height,
}: {
  data: { date: string; calories: number; compare: number | null }[]; // already windowed to [windowStart, windowEnd] by the caller
  compareLabel: string;
  compareColor: string;
  emptyMessage: string;
  windowStart: number;
  windowEnd: number;
  height: number;
}) {
  const { unit: energyUnit } = useEnergyUnit();

  const hasCompare = data.some((d) => d.compare !== null);
  if (!hasCompare) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-sm text-muted text-center px-8">{emptyMessage}</p>
      </div>
    );
  }

  const displayData = data.map((d) => ({
    ts: dayIndex(d.date),
    calories: Math.round(kcalToUnit(d.calories, energyUnit)),
    compare: d.compare !== null ? Math.round(kcalToUnit(d.compare, energyUnit)) : null,
  }));

  const visibleValues = displayData.flatMap((d) => (d.compare !== null ? [d.calories, d.compare] : [d.calories]));
  const pad = kcalToUnit(200, energyUnit);
  const domain: [number, number] = [Math.max(0, Math.min(...visibleValues) - pad), Math.max(...visibleValues) + pad];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={displayData} margin={CHART_MARGIN}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          type="number"
          dataKey="ts"
          domain={[windowStart, windowEnd]}
          allowDataOverflow
          tickFormatter={formatShortTs}
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          domain={domain}
          allowDataOverflow
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
        />
        <Tooltip
          content={<CustomTooltip compareLabel={compareLabel} compareColor={compareColor} />}
          cursor={{ fill: GRID, opacity: 0.3 }}
        />
        <Bar dataKey="calories" fill={IN} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        <Line
          type="stepAfter"
          dataKey="compare"
          stroke={compareColor}
          strokeWidth={2}
          strokeDasharray="2 3"
          dot={false}
          isAnimationActive={false}
          activeDot={{ r: 4, fill: compareColor }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
