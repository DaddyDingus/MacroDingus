import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { Checkin } from "../api/coach";

const ACCENT = "#6BE4C0";
const GRID = "#33373E";
const MUTED = "#8A8F98";

function formatShortDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return new Date(2000, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-raised border border-line rounded-md px-3 py-2 text-xs">
      <p className="text-muted mb-1">{formatShortDate(label)}</p>
      <p className="flex items-center gap-2">
        <span className="inline-block w-3 h-[2px]" style={{ background: ACCENT }} />
        <span className="tabular text-ink">{Math.round(payload[0].value)} kcal</span>
        <span className="text-muted">TDEE</span>
      </p>
    </div>
  );
}

// One series, one axis — TDEE only. Target calories and trend weight already
// have their own homes (the big number above, the weight detail page), so
// this stays a single clean line rather than overlaying mismatched series.
export default function TdeeChart({ checkins }: { checkins: Checkin[] }) {
  if (checkins.length < 2) {
    return (
      <div className="h-[220px] flex items-center justify-center">
        <p className="text-sm text-muted">Check in a couple more times to see a trend.</p>
      </div>
    );
  }

  const data = checkins.map((c) => ({ date: c.date, tdee: c.tdee }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
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
          domain={["dataMin - 100", "dataMax + 100"]}
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: GRID }} />
        <Line
          type="monotone"
          dataKey="tdee"
          stroke={ACCENT}
          strokeWidth={2}
          dot={{ r: 3, fill: ACCENT, strokeWidth: 0 }}
          isAnimationActive={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
