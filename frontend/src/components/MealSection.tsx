import type { LogEntry, Meal } from "../api/types";

const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snacks: "Snacks",
};

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

export default function MealSection({
  meal,
  entries,
  onAdd,
  onEdit,
  onDelete,
}: {
  meal: Meal;
  entries: LogEntry[];
  onAdd: () => void;
  onEdit: (entry: LogEntry) => void;
  onDelete: (id: string) => void;
}) {
  const subtotal = entries.reduce((sum, e) => sum + e.nutrition.calories, 0);

  return (
    <div className="border border-line bg-surface rounded-md overflow-hidden">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-line">
        <span className="text-sm font-medium">{MEAL_LABELS[meal]}</span>
        {entries.length > 0 && <span className="tabular text-xs text-muted">{fmt(subtotal)} kcal</span>}
      </div>

      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center justify-between px-4 py-2.5 border-b border-line/60 last:border-b-0"
        >
          <button
            onClick={() => onEdit(entry)}
            className="flex-1 min-w-0 text-left active:opacity-70"
          >
            <span className="block text-sm truncate">{entry.food.name}</span>
            <span className="block text-xs text-muted tabular">{fmt(entry.quantityGrams)} g</span>
          </button>
          <span className="flex items-center gap-3 shrink-0">
            <span className="tabular text-sm">{fmt(entry.nutrition.calories)}</span>
            <button
              type="button"
              aria-label={`Remove ${entry.food.name}`}
              onClick={() => onDelete(entry.id)}
              className="text-muted text-lg leading-none px-2 py-1 active:text-ink"
            >
              ×
            </button>
          </span>
        </div>
      ))}

      <button
        onClick={onAdd}
        className="w-full px-4 py-2.5 text-sm text-accent text-left active:bg-surface-raised"
      >
        + Add food
      </button>
    </div>
  );
}
