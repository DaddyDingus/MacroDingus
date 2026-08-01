import { BarChart, Bar, ResponsiveContainer } from "recharts";

// Same triad as MacroHistoryChart/MacroSummaryBar — stacked by calorie
// contribution, not raw grams, for the same reason.
const PROTEIN = "#EF8D6A";
const CARBS = "#5ABC80";
const FAT = "#F7D372";

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
        {/* Not inside ChartCard's pan/pinch gesture system (unlike
            MacroHistoryChart/NutrientHistoryChart, which keep this off) —
            data only changes on mount/refetch here, not every gesture frame,
            so recharts' built-in grow-and-morph animation is safe. Slight
            animationBegin stagger per series layers the stack's reveal
            (protein grows, then carbs, then fat) instead of all three
            popping at once. */}
        <Bar dataKey="proteinKcal" stackId="cal" fill={PROTEIN} animationDuration={500} animationEasing="ease-out" />
        <Bar
          dataKey="carbsKcal"
          stackId="cal"
          fill={CARBS}
          animationDuration={500}
          animationEasing="ease-out"
          animationBegin={60}
        />
        <Bar
          dataKey="fatKcal"
          stackId="cal"
          fill={FAT}
          radius={[1, 1, 0, 0]}
          animationDuration={500}
          animationEasing="ease-out"
          animationBegin={120}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
