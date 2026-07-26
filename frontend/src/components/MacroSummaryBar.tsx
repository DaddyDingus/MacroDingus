import type { Nutrition } from "../api/types";
import TargetProgressBar from "./TargetProgressBar";

export interface MacroTargets {
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

// Same categorical hex values as tailwind.config.js (calories/protein/fat/
// carbs) — kept as raw hex here since TargetProgressBar takes a color prop
// rather than a Tailwind class, same pattern DashboardTileSections uses.
const METRICS: { key: "calories" | "protein" | "fat" | "carbs"; label: string; color: string }[] = [
  { key: "calories", label: "Calories", color: "#3987E5" },
  { key: "protein", label: "Protein", color: "#D95926" },
  { key: "fat", label: "Fat", color: "#F0B400" },
  { key: "carbs", label: "Carbs", color: "#059669" },
];

export default function MacroSummaryBar({ totals, targets }: { totals: Nutrition; targets: MacroTargets | null }) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {METRICS.map((m) => {
        const value = totals[m.key];
        const target = targets ? (m.key === "calories" ? targets.calories : targets[`${m.key}G` as "proteinG" | "fatG" | "carbsG"]) : 0;
        const decimals = m.key === "calories" ? 0 : 1;
        return (
          <div key={m.key} className="min-w-0">
            <p className="text-[9px] tracking-wide uppercase text-muted truncate">{m.label}</p>
            <div className="mt-1.5">
              <TargetProgressBar value={value} target={target} color={m.color} />
            </div>
            <p className="tabular text-[10px] text-white/70 mt-1 truncate">
              {fmt(value, decimals)}
              {targets && <span className="text-muted">/{fmt(target, decimals)}</span>}
            </p>
          </div>
        );
      })}
    </div>
  );
}
