import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GoalWeightPoint } from "../lib/goalProgressInsights";
import { kgToUnit, type WeightUnit } from "../lib/weightUnit";
import { dayIndex } from "../lib/date";
import { formatShortTs } from "../lib/chartLayout";

const GRID = "rgb(var(--color-divider))";
const MUTED = "#8A8F98";

function CustomTooltip({ active, payload, unit }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{point.kind === "start" ? "Goal start" : point.kind === "current" ? "Latest" : formatShortTs(point.ts)}</p>
      <p className="tabular text-ink">
        {point.weight} {unit}
      </p>
      <p className="tabular text-muted mt-0.5">{point.distance} {unit} remaining</p>
    </div>
  );
}

// The chart shows the actual selected weight series (scale or trend), while a
// target line makes the remaining gap visible without making users mentally
// translate a "kg remaining" axis back into their own bodyweight.
export default function GoalWaterfallChart({
  series,
  color,
  unit,
  targetWeightKg,
  title,
}: {
  series: GoalWeightPoint[];
  color: string;
  unit: WeightUnit;
  targetWeightKg: number;
  title: string;
}) {
  if (series.length < 2) {
    return (
      <div className="h-[220px] flex items-center justify-center">
        <p className="text-sm text-muted text-center max-w-[15rem]">Your starting weight is set. Log another weight to see your path to the goal.</p>
      </div>
    );
  }

  const data = series.map((point) => ({
    ts: dayIndex(point.date),
    weight: Math.round(kgToUnit(point.weightKg, unit) * 10) / 10,
    distance: Math.round(kgToUnit(point.distanceKg, unit) * 10) / 10,
    kind: point.kind,
  }));
  const targetWeight = kgToUnit(targetWeightKg, unit);
  const minWeight = Math.min(targetWeight, ...data.map((point) => point.weight));
  const maxWeight = Math.max(targetWeight, ...data.map((point) => point.weight));
  const weightPadding = Math.max(0.25, (maxWeight - minWeight) * 0.12);
  const yDomain: [number, number] = [minWeight - weightPadding, maxWeight + weightPadding];
  const firstTs = data[0].ts;
  const lastTs = data[data.length - 1].ts;
  // A little breathing room prevents the start/latest dots being clipped by
  // the plot edge. Explicit checkpoint ticks also keep a date label directly
  // beneath each point, rather than showing arbitrary calendar dates between
  // measurements.
  const xDomain: [number, number] = [firstTs - 1, lastTs + 1];
  const tickLimit = 4;
  const tickStep = Math.max(1, Math.ceil((data.length - 1) / (tickLimit - 1)));
  const xTicks = Array.from(new Set([...data.filter((_, index) => index % tickStep === 0).map((point) => point.ts), lastTs]));

  return (
    <div>
      <div className="flex items-baseline justify-between px-1 pb-2">
        <p className="text-xs font-medium text-ink">{title}</p>
        <p className="tabular text-[11px] text-muted">Target {targetWeight.toFixed(1)} {unit}</p>
      </div>
      <ResponsiveContainer width="100%" height={196}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            type="number"
            dataKey="ts"
            domain={xDomain}
            allowDataOverflow
            ticks={xTicks}
            tickFormatter={formatShortTs}
            tick={{ fill: MUTED, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={yDomain}
            tick={{ fill: MUTED, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={36}
            tickFormatter={(value: number) => value.toFixed(1)}
          />
          <ReferenceLine y={targetWeight} stroke="#F7D372" strokeOpacity={0.9} strokeDasharray="4 4" />
          <Tooltip content={<CustomTooltip unit={unit} />} cursor={{ stroke: GRID }} />
          <Line
            type="monotone"
            dataKey="weight"
            stroke={color}
            strokeWidth={2.5}
            dot={{ r: 3.5, fill: color, stroke: "rgb(var(--color-card))", strokeWidth: 2 }}
            activeDot={{ r: 5, fill: color, stroke: "rgb(var(--color-card))", strokeWidth: 2 }}
            isAnimationActive
            animationDuration={500}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
