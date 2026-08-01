import type { LogEntry } from "../api/types";
import FoodIconAvatar from "./FoodIconAvatar";
import { useEnergyUnit, kcalToUnit } from "../lib/energyUnit";

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

export default function FoodItemCard({
  entry,
  selected = false,
  onSelect,
  onDelete,
}: {
  entry: LogEntry;
  selected?: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { unit: energyUnit } = useEnergyUnit();
  return (
    <div
      className={`flex items-center gap-2.5 rounded-2xl px-3 py-2 transition-colors ${
        selected ? "bg-accent/10" : "bg-dashboardCard"
      }`}
    >
      <FoodIconAvatar name={entry.food.name} icon={entry.food.icon} />
      <button onClick={onSelect} className="flex-1 min-w-0 text-left active:opacity-70">
        <span className="block text-sm text-white leading-tight line-clamp-2">{entry.food.name}</span>
        <span className="block text-xs text-muted tabular leading-tight truncate -mt-0.5">
          {fmt(entry.quantityGrams)} g · {fmt(entry.nutrition.protein)}P {fmt(entry.nutrition.fat)}F{" "}
          {fmt(entry.nutrition.carbs)}C
        </span>
      </button>
      <span className="flex items-center gap-2.5 shrink-0">
        <span className="tabular text-sm text-white">{fmt(kcalToUnit(entry.nutrition.calories, energyUnit))}</span>
        <button
          type="button"
          aria-label={`Remove ${entry.food.name}`}
          onClick={onDelete}
          className="text-muted text-lg leading-none px-1 active:text-white"
        >
          ×
        </button>
      </span>
    </div>
  );
}
