import type { LogEntry } from "../api/types";
import FoodIconAvatar from "./FoodIconAvatar";

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

export default function FoodItemCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: LogEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 bg-dashboardCard rounded-2xl px-3 py-2">
      <FoodIconAvatar name={entry.food.name} />
      <button onClick={onEdit} className="flex-1 min-w-0 text-left active:opacity-70">
        <span className="block text-sm text-white leading-tight line-clamp-2">{entry.food.name}</span>
        <span className="block text-xs text-muted tabular leading-tight truncate -mt-0.5">
          {fmt(entry.quantityGrams)} g · {fmt(entry.nutrition.protein)}P {fmt(entry.nutrition.fat)}F{" "}
          {fmt(entry.nutrition.carbs)}C
        </span>
      </button>
      <span className="flex items-center gap-2.5 shrink-0">
        <span className="tabular text-sm text-white">{fmt(entry.nutrition.calories)}</span>
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
