import { useState } from "react";
import type { LogEntry, Meal } from "../api/types";
import { useDayLog, useDeleteLog } from "../api/logs";
import { addDays, formatDayLabel, localDateString } from "../lib/date";
import DailyFactsPanel from "../components/DailyFactsPanel";
import MealSection from "../components/MealSection";
import AddFoodSheet from "../components/AddFoodSheet";

const MEALS: Meal[] = ["breakfast", "lunch", "dinner", "snacks"];

export default function TodayScreen() {
  const [date, setDate] = useState(localDateString());
  const dayLog = useDayLog(date);
  const deleteLog = useDeleteLog(date);

  const [sheetMeal, setSheetMeal] = useState<Meal | null>(null);
  const [editingEntry, setEditingEntry] = useState<LogEntry | null>(null);
  const sheetOpen = sheetMeal !== null || editingEntry !== null;

  function closeSheet() {
    setSheetMeal(null);
    setEditingEntry(null);
  }

  const entries = dayLog.data?.entries ?? [];
  const totals = dayLog.data?.totals ?? {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    sugar: 0,
    saturatedFat: 0,
    sodiumMg: 0,
  };

  return (
    <div className="min-h-dvh pb-10">
      <header className="px-4 pt-5 pb-3 flex items-center justify-between">
        <button
          onClick={() => setDate((d) => addDays(d, -1))}
          className="text-muted text-xl leading-none px-2 py-1"
          aria-label="Previous day"
        >
          ‹
        </button>
        <span className="text-sm font-medium">{formatDayLabel(date)}</span>
        <button
          onClick={() => setDate((d) => addDays(d, 1))}
          disabled={date === localDateString()}
          className="text-muted text-xl leading-none px-2 py-1 disabled:opacity-30"
          aria-label="Next day"
        >
          ›
        </button>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <DailyFactsPanel totals={totals} />

        {MEALS.map((meal) => (
          <MealSection
            key={meal}
            meal={meal}
            entries={entries.filter((e) => e.meal === meal)}
            onAdd={() => setSheetMeal(meal)}
            onEdit={(entry) => setEditingEntry(entry)}
            onDelete={(id) => deleteLog.mutate(id)}
          />
        ))}
      </main>

      <AddFoodSheet
        open={sheetOpen}
        meal={sheetMeal}
        date={date}
        editingEntry={editingEntry}
        onClose={closeSheet}
      />
    </div>
  );
}
