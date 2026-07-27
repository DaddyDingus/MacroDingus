import type { Nutrition } from "../api/types";

export interface MacroTargets {
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function pct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, (value / target) * 100));
}

// Same categorical hex values as tailwind.config.js (calories/protein/fat/
// carbs) — kept as raw hex here rather than a Tailwind class since the fill
// color is set via inline style, same pattern DashboardTileSections uses.
const METRICS: { key: "calories" | "protein" | "fat" | "carbs"; label: string; color: string }[] = [
  { key: "calories", label: "Calories", color: "#3987E5" },
  { key: "protein", label: "Protein", color: "#D95926" },
  { key: "fat", label: "Fat", color: "#F0B400" },
  { key: "carbs", label: "Carbs", color: "#059669" },
];

// Deliberately not built on TargetProgressBar — that component's target tick
// is the wrong look here. This instead mirrors DashboardTotalsArcCard's own
// macro row exactly (h-1 track, no tick, fully rounded ends) so the Home
// Dashboard and Food Log headers read as the same visual system.
export default function MacroSummaryBar({ totals, targets }: { totals: Nutrition; targets: MacroTargets | null }) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {METRICS.map((m) => {
        const value = totals[m.key];
        const target = targets ? (m.key === "calories" ? targets.calories : targets[`${m.key}G` as "proteinG" | "fatG" | "carbsG"]) : 0;
        const decimals = m.key === "calories" ? 0 : 1;
        return (
          <div key={m.key} className="min-w-0 flex flex-col items-center text-center">
            <p className="text-[11px] tracking-widest uppercase text-muted truncate">{m.label}</p>
            <span className="block h-1 w-full rounded-full bg-dashboardTrack overflow-hidden mt-1.5">
              <span
                className="block h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${pct(value, target)}%`, backgroundColor: m.color }}
              />
            </span>
            <p className="tabular mt-1 truncate">
              <span className="text-[11px] font-medium text-white">{fmt(value, decimals)}</span>
              {targets && <span className="text-[9px] text-muted">/{fmt(target, decimals)}</span>}
            </p>
          </div>
        );
      })}
    </div>
  );
}
