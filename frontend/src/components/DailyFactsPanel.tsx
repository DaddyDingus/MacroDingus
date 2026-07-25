import type { Nutrition } from "../api/types";

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export default function DailyFactsPanel({ totals }: { totals: Nutrition }) {
  return (
    <div className="border border-line bg-surface rounded-md overflow-hidden">
      <div className="px-5 pt-4 pb-2">
        <p className="text-[11px] tracking-widest uppercase text-muted">Today's totals</p>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className="tabular text-4xl font-medium tracking-tight">{fmt(totals.calories)}</span>
          <span className="text-sm text-muted">kcal</span>
        </div>
      </div>

      <div className="h-[3px] bg-ink" />

      <div className="px-5 py-2.5 flex items-center justify-between border-b border-line/70">
        <span className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full bg-protein" /> Protein
        </span>
        <span className="tabular text-sm">{fmt(totals.protein, 1)} g</span>
      </div>
      <div className="px-5 py-2.5 flex items-center justify-between border-b border-line/70">
        <span className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full bg-carbs" /> Carbs
        </span>
        <span className="tabular text-sm">{fmt(totals.carbs, 1)} g</span>
      </div>
      <div className="px-5 py-2.5 flex items-center justify-between border-b border-line">
        <span className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full bg-fat" /> Fat
        </span>
        <span className="tabular text-sm">{fmt(totals.fat, 1)} g</span>
      </div>

      <div className="px-5 py-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-muted">
        <div className="flex justify-between">
          <span>Fiber</span>
          <span className="tabular text-ink/80">{fmt(totals.fiber, 1)} g</span>
        </div>
        <div className="flex justify-between">
          <span>Sugar</span>
          <span className="tabular text-ink/80">{fmt(totals.sugar, 1)} g</span>
        </div>
        <div className="flex justify-between">
          <span>Sat. fat</span>
          <span className="tabular text-ink/80">{fmt(totals.saturatedFat, 1)} g</span>
        </div>
        <div className="flex justify-between">
          <span>Sodium</span>
          <span className="tabular text-ink/80">{fmt(totals.sodiumMg)} mg</span>
        </div>
      </div>
    </div>
  );
}
