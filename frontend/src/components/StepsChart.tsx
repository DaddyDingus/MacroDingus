import { Bar, CartesianGrid, Cell, ComposedChart, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { StepDay } from "../api/steps";
import { dayIndex } from "../lib/date";
import { CHART_MARGIN, GRID, MUTED, formatShortTs } from "../lib/chartLayout";

const COMPLETE = "#5ABC80";
const PARTIAL = "#749EF4";

function StepsTooltip({ active, payload, label }: any) {
  if (!active) return null;
  const point = payload?.[0]?.payload as { steps: number | null; state: StepDay["state"] } | undefined;
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{formatShortTs(label)}</p>
      <p className="tabular">{point?.steps == null ? "Unavailable" : `${point.steps.toLocaleString()} steps`}</p>
      {point?.state === "partial" && <p className="text-calories mt-0.5">Partial day</p>}
    </div>
  );
}

export default function StepsChart({
  points, hasData, goal, windowStart, windowEnd, height,
}: {
  points: StepDay[];
  hasData: boolean;
  goal: number;
  windowStart: number;
  windowEnd: number;
  height: number;
}) {
  if (!hasData) return <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>Sync Steps to begin.</div>;
  const data = points.map((point) => ({
    ts: dayIndex(point.date),
    steps: point.steps,
    state: point.state,
    zero: point.steps === 0 ? 0 : null,
  }));
  const visible = data.flatMap((point) => point.steps == null ? [] : [point.steps]);
  const maximum = Math.max(goal, ...visible, 1);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis type="number" dataKey="ts" domain={[windowStart, windowEnd]} allowDataOverflow tickFormatter={formatShortTs} tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
        <YAxis domain={[0, Math.ceil(maximum * 1.1)]} allowDataOverflow tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} width={44} allowDecimals={false} tickFormatter={(value: number) => value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(value)} />
        <Tooltip content={<StepsTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <ReferenceLine y={goal} stroke="#F7D372" strokeDasharray="4 4" />
        <Bar dataKey="steps" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={26}>
          {data.map((point, index) => <Cell key={index} fill={point.state === "partial" ? PARTIAL : COMPLETE} />)}
        </Bar>
        <Scatter dataKey="zero" fill={COMPLETE} shape="circle" isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function StepsChartLegend() {
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-muted">
      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: COMPLETE }} /> Complete</span>
      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: PARTIAL }} /> Today partial</span>
      <span>Gaps = unavailable</span>
    </div>
  );
}
