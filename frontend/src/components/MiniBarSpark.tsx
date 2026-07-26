import { BarChart, Bar, ResponsiveContainer } from "recharts";

// Same triad as MacroHistoryChart/MacroSummaryBar — stacked by calorie
// contribution, not raw grams, for the same reason.
const PROTEIN = "#D95926";
const CARBS = "#059669";
const FAT = "#F0B400";

export interface MiniBarPoint {
  proteinKcal: number;
  carbsKcal: number;
  fatKcal: number;
}

export default function MiniBarSpark({ points }: { points: MiniBarPoint[] }) {
  const hasData = points.some((p) => p.proteinKcal + p.carbsKcal + p.fatKcal > 0);
  if (!hasData) {
    return <div className="h-full flex items-center text-[11px] text-muted">Not enough data yet</div>;
  }
  const data = points.map((p, i) => ({ i, ...p }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }} barCategoryGap={2}>
        <Bar dataKey="proteinKcal" stackId="cal" fill={PROTEIN} isAnimationActive={false} />
        <Bar dataKey="carbsKcal" stackId="cal" fill={CARBS} isAnimationActive={false} />
        <Bar dataKey="fatKcal" stackId="cal" fill={FAT} radius={[1, 1, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
