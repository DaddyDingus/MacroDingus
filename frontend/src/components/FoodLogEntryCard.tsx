import type { LogEntry } from "../api/types";

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

export default function FoodLogEntryCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: LogEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 bg-dashboardCard rounded-2xl px-4 py-3">
      <button onClick={onEdit} className="flex-1 min-w-0 text-left active:opacity-70">
        <span className="block text-sm text-white truncate">{entry.food.name}</span>
        <span className="block text-xs text-muted tabular">{fmt(entry.quantityGrams)} g</span>
      </button>
      <span className="flex items-center gap-3 shrink-0">
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
