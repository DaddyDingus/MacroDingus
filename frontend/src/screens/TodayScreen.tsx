import { useState } from "react";
import type { LogEntry, Meal } from "../api/types";
import { useDayLog, useDeleteLog } from "../api/logs";
import { useAuthStatus } from "../api/auth";
import { useCoachStatus } from "../api/coach";
import { addDays, formatDayLabel, localDateString } from "../lib/date";
import DailyFactsPanel from "../components/DailyFactsPanel";
import MealSection from "../components/MealSection";
import AddFoodSheet from "../components/AddFoodSheet";
import CopyDaySheet from "../components/CopyDaySheet";

const MEALS: Meal[] = ["breakfast", "lunch", "dinner", "snacks"];

export default function TodayScreen() {
  const [date, setDate] = useState(localDateString());
  const dayLog = useDayLog(date);
  const deleteLog = useDeleteLog(date);
  const authStatus = useAuthStatus();
  const coachStatus = useCoachStatus();

  const [sheetMeal, setSheetMeal] = useState<Meal | null>(null);
  const [editingEntry, setEditingEntry] = useState<LogEntry | null>(null);
  const sheetOpen = sheetMeal !== null || editingEntry !== null;

  const [copyTarget, setCopyTarget] = useState<{ meal?: Meal } | null>(null);

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

  const checkin = coachStatus.data?.latestCheckin;
  const targets =
    date === localDateString() && checkin
      ? {
          calories: checkin.targetCalories,
          proteinG: checkin.targetProteinG,
          carbsG: checkin.targetCarbsG,
          fatG: checkin.targetFatG,
        }
      : null;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-1 flex items-center justify-between">
        <button
          onClick={() => setDate((d) => addDays(d, -1))}
          className="text-muted text-xl leading-none px-2 py-1"
          aria-label="Previous day"
        >
          ‹
        </button>
        <span className="flex flex-col items-center leading-tight">
          {authStatus.data?.user?.name && (
            <span className="text-[10px] tracking-widest uppercase text-muted">
              {authStatus.data.user.name}
            </span>
          )}
          <span className="text-sm font-medium">{formatDayLabel(date)}</span>
        </span>
        <button
          onClick={() => setDate((d) => addDays(d, 1))}
          disabled={date === localDateString()}
          className="text-muted text-xl leading-none px-2 py-1 disabled:opacity-30"
          aria-label="Next day"
        >
          ›
        </button>
      </header>

      <div className="px-4 pb-3 flex justify-end max-w-md mx-auto">
        <button onClick={() => setCopyTarget({})} className="text-xs text-accent">
          Copy a day
        </button>
      </div>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <DailyFactsPanel totals={totals} targets={targets} />

        {MEALS.map((meal) => (
          <MealSection
            key={meal}
            meal={meal}
            entries={entries.filter((e) => e.meal === meal)}
            onAdd={() => setSheetMeal(meal)}
            onEdit={(entry) => setEditingEntry(entry)}
            onDelete={(id) => deleteLog.mutate(id)}
            onCopy={() => setCopyTarget({ meal })}
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

      {copyTarget && (
        <CopyDaySheet targetDate={date} meal={copyTarget.meal} onClose={() => setCopyTarget(null)} />
      )}
    </div>
  );
}
