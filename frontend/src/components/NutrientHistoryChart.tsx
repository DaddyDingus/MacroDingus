import { ComposedChart, Bar, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { dayIndex } from "../lib/date";
import { CHART_MARGIN, GRID, MUTED, formatShortTs } from "../lib/chartLayout";

const TARGET_COLOR = "#ECEDEE"; // `ink` — neutral, so it reads distinct from the metric's own colored bars

function CustomTooltip({ active, payload, label, color, unit }: any) {
  if (!active || !payload?.length) return null;
  const valueEntry = payload.find((p: any) => p.dataKey === "value");
  const targetEntry = payload.find((p: any) => p.dataKey === "target");
  if (!valueEntry) return null;
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{formatShortTs(label)}</p>
      <p className="flex items-center gap-2">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
        <span className="tabular text-ink">
          {Math.round(valueEntry.value)} {unit}
        </span>
      </p>
      {targetEntry?.value != null && (
        <p className="flex items-center gap-2 mt-0.5">
          <span className="inline-block w-3 h-[2px]" style={{ background: TARGET_COLOR }} />
          <span className="tabular text-ink">
            {Math.round(targetEntry.value)} {unit}
          </span>
          <span className="text-muted">target</span>
        </p>
      )}
    </div>
  );
}

export interface NutrientChartPoint {
  date: string;
  value: number;
  target: number | null;
  // Only ever populated for the calories metric (see NutrientDetailScreen) —
  // reuses the real per-check-in tdeeFluxKcal rather than fabricating a
  // variance for grams-based macro targets, which have no equivalent
  // measured source. Null means "no range to show", not zero.
  flux: number | null;
}

// Split out from the chart itself so the screen can place it in ChartCard's
// legend slot below the RangeToggle, matching every other history chart's
// layout (see chartLayout.ts). hasTarget/hasRange mirror the same
// data-derived conditionals the chart component computes internally.
export function NutrientHistoryChartLegend({ data, color }: { data: NutrientChartPoint[]; color: string }) {
  const hasTarget = data.some((d) => d.target !== null);
  const hasRange = data.some((d) => d.target !== null && d.flux !== null);
  return (
    <>
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
        Intake
      </span>
      {hasTarget && (
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block w-3 h-[2px] border-t border-dashed" style={{ borderColor: TARGET_COLOR }} />
          Target
        </span>
      )}
      {hasRange && (
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color, opacity: 0.3 }} />
          Range
        </span>
      )}
    </>
  );
}

// Bars for the actual daily value (a day's total is a discrete, complete
// number, same reasoning as EnergyBalanceChart), a dashed step line for the
// day's active target, and — calories only — a shaded low/high band built
// from tdeeFluxKcal via the same stacked-Area technique TdeeChart's Flux
// Range band uses.
export default function NutrientHistoryChart({
  data,
  hasData,
  color,
  unit,
  windowStart,
  windowEnd,
  height,
}: {
  data: NutrientChartPoint[]; // already windowed to [windowStart, windowEnd] by the caller
  hasData: boolean; // whether there's ANY logged value at all, independent of the current window
  color: string;
  unit: string;
  windowStart: number;
  windowEnd: number;
  height: number;
}) {
  if (!hasData) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-sm text-muted">Log some food to see your history.</p>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ts: dayIndex(d.date),
    value: Math.round(d.value * 10) / 10,
    target: d.target,
    low: d.target !== null && d.flux !== null ? d.target - d.flux : undefined,
    band: d.target !== null && d.flux !== null ? d.flux * 2 : undefined,
  }));

  const hasTarget = chartData.some((d) => d.target !== null);
  const hasRange = chartData.some((d) => d.band !== undefined);

  const visibleValues = chartData.flatMap((d) => {
    const vals = [d.value];
    if (d.target !== null) vals.push(d.target);
    if (d.low !== undefined && d.band !== undefined) vals.push(d.low, d.low + d.band);
    return vals;
  });
  const domain: [number, number] = [0, Math.max(...visibleValues, 0) * 1.15];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={chartData} margin={CHART_MARGIN}>
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
          domain={domain}
          allowDataOverflow
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))}
        />
        <Tooltip content={<CustomTooltip color={color} unit={unit} />} cursor={{ fill: GRID, opacity: 0.3 }} />
        {hasRange && (
          <>
            <Area type="stepAfter" dataKey="low" stackId="range" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area
              type="stepAfter"
              dataKey="band"
              stackId="range"
              stroke="none"
              fill={color}
              fillOpacity={0.15}
              isAnimationActive={false}
            />
          </>
        )}
        <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        {hasTarget && (
          <Line
            type="stepAfter"
            dataKey="target"
            stroke={TARGET_COLOR}
            strokeWidth={1.5}
            strokeDasharray="2 3"
            dot={false}
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
