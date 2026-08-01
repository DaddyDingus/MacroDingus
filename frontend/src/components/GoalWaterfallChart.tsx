import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { WeeklyDistancePoint } from "../lib/goalProgressInsights";
import { kgToUnit, type WeightUnit } from "../lib/weightUnit";

const GRID = "rgb(var(--color-divider))";
const MUTED = "#8A8F98";
const STATUS_COLOR = "#8A8F98";

function CustomTooltip({ active, payload, unit }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const directionText = point.direction === "towards" ? "Towards goal" : point.direction === "away" ? "Away from goal" : "Current";
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{point.label}</p>
      <p className="tabular text-ink">
        {point.distance} {unit} to go
      </p>
      <p className="text-muted mt-0.5">{directionText}</p>
    </div>
  );
}

// Distance-to-goal at the end of each week since the goal started, as a
// staircase of bars rather than a line — each bar's color (not just its
// height) carries information: full-opacity `color` for a week that moved
// distance closer to goal ("towards"), the same hue at reduced opacity for
// a week that moved further away ("away"), and neutral grey for the final
// "Status" bar (today, not a completed week). Reusing one hue at two
// opacities rather than two unrelated colors keeps "towards"/"away" legible
// as a single continuum (closer vs. further) rather than reading as two
// unrelated categories the way e.g. red/green would.
export default function GoalWaterfallChart({
  buckets,
  color,
  unit,
}: {
  buckets: WeeklyDistancePoint[];
  color: string;
  unit: WeightUnit;
}) {
  if (buckets.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center">
        <p className="text-sm text-muted">Not enough history yet to chart your progress.</p>
      </div>
    );
  }

  const data = buckets.map((b) => ({
    label: b.label,
    distance: Math.round(kgToUnit(b.distanceKg, unit) * 10) / 10,
    direction: b.direction,
  }));
  const maxDistance = Math.max(...data.map((d) => d.distance));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          minTickGap={30}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[0, maxDistance * 1.1]}
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={32}
        />
        <Tooltip content={<CustomTooltip unit={unit} />} cursor={{ fill: GRID, opacity: 0.3 }} />
        <Bar dataKey="distance" radius={[2, 2, 0, 0]} isAnimationActive animationDuration={500} animationEasing="ease-out">
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.direction === "status" ? STATUS_COLOR : color}
              fillOpacity={d.direction === "away" ? 0.45 : d.direction === "status" ? 0.6 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
