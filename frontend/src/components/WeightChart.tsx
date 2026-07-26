import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { TrendPoint } from "../api/weights";
import { kgToUnit, type WeightUnit } from "../lib/weightUnit";

const ACCENT = "#9085E9";
const SCALE_DOT = "#8A8F98";
const GRID = "#33373E";
const MUTED = "#8A8F98";

function formatShortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return new Date(2000, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function CustomTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  const trend = payload.find((p: any) => p.dataKey === "trendDisplay");
  const scale = payload.find((p: any) => p.dataKey === "weightDisplay");
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{formatShortDate(label)}</p>
      {trend && (
        <p className="flex items-center gap-2">
          <span className="inline-block w-3 h-[2px]" style={{ background: ACCENT }} />
          <span className="tabular text-ink">
            {trend.value.toFixed(1)} {unit}
          </span>
          <span className="text-muted">trend</span>
        </p>
      )}
      {scale && (
        <p className="flex items-center gap-2 mt-0.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: SCALE_DOT }} />
          <span className="tabular text-ink">
            {scale.value.toFixed(1)} {unit}
          </span>
          <span className="text-muted">scale</span>
        </p>
      )}
    </div>
  );
}

export default function WeightChart({ points, unit }: { points: TrendPoint[]; unit: WeightUnit }) {
  if (points.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center">
        <p className="text-sm text-muted">Log a weight to start seeing your trend.</p>
      </div>
    );
  }

  const data = points.map((p) => ({
    date: p.date,
    weightDisplay: Math.round(kgToUnit(p.weightKg, unit) * 10) / 10,
    trendDisplay: Math.round(kgToUnit(p.trendKg, unit) * 10) / 10,
  }));

  return (
    <div>
      <div className="flex items-center gap-4 px-1 pb-2">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block w-3 h-[2px]" style={{ background: ACCENT }} />
          Trend
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: SCALE_DOT }} />
          Scale
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
            domain={["dataMin - 1", "dataMax + 1"]}
            tick={{ fill: MUTED, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
          <Tooltip content={<CustomTooltip unit={unit} />} cursor={{ stroke: GRID }} />
          <Line
            type="monotone"
            dataKey="weightDisplay"
            stroke="none"
            dot={{ r: 3, fill: SCALE_DOT, strokeWidth: 0 }}
            isAnimationActive={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="trendDisplay"
            stroke={ACCENT}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            activeDot={{ r: 4, fill: ACCENT }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
