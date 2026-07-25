import type { Meal } from "../api/types";
import { useRecentDays, useCopyDay } from "../api/logs";
import { formatDayLabel } from "../lib/date";

const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snacks: "Snacks",
};

export default function CopyDaySheet({
  targetDate,
  meal,
  onClose,
}: {
  targetDate: string;
  meal?: Meal;
  onClose: () => void;
}) {
  const recentDays = useRecentDays(meal);
  const copyDay = useCopyDay(targetDate);

  const days = (recentDays.data ?? []).filter((d) => d.date !== targetDate);

  function pick(sourceDate: string) {
    copyDay.mutate({ sourceDate, meal });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[75vh] flex flex-col bg-surface rounded-t-xl border-t border-line">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
          <span className="text-sm font-medium">Copy {meal ? MEAL_LABELS[meal] : "a day"} from…</span>
          <button onClick={onClose} className="text-muted text-xl leading-none px-1">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-4">
          {days.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted text-center">
              {meal ? `Nothing logged for ${MEAL_LABELS[meal]} yet.` : "Nothing logged yet."}
            </p>
          )}
          {days.map((d) => (
            <button
              key={d.date}
              onClick={() => pick(d.date)}
              className="w-full flex items-center justify-between px-4 py-3 border-b border-line/60 text-left active:bg-surface-raised"
            >
              <span className="text-sm">{formatDayLabel(d.date)}</span>
              <span className="tabular text-xs text-muted">
                {d.calories} kcal · {d.entryCount} item{d.entryCount === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
