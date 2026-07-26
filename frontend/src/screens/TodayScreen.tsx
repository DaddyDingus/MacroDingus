import { useState } from "react";
import type { LogEntry } from "../api/types";
import { useDayLog, useDeleteLog } from "../api/logs";
import { useAuthStatus } from "../api/auth";
import { useCoachStatus } from "../api/coach";
import { addDays, formatDayLabel, formatLogTime, localDateString } from "../lib/date";
import { groupLogEntriesByTime } from "../lib/logGrouping";
import MacroSummaryBar from "../components/MacroSummaryBar";
import FoodLogEntryCard from "../components/FoodLogEntryCard";
import AddFoodSheet from "../components/AddFoodSheet";
import CopyDaySheet from "../components/CopyDaySheet";

const EMPTY_TOTALS = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, saturatedFat: 0, sodiumMg: 0 };

// Blank-by-default timeline: no Breakfast/Lunch/Dinner/Snacks sections
// (removed app-wide — see backend/src/db/schema.ts and every route/hook that
// used to take a `meal`). Entries are grouped purely by how close together in
// time they were logged (lib/logGrouping.ts), each rendered as its own dark
// card, with a shared timestamp per group acting as a node on the vertical
// timeline line down the right edge.
export default function TodayScreen() {
  const [date, setDate] = useState(localDateString());
  const dayLog = useDayLog(date);
  const deleteLog = useDeleteLog(date);
  const authStatus = useAuthStatus();
  const coachStatus = useCoachStatus();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LogEntry | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);

  function openAdd() {
    setEditingEntry(null);
    setSheetOpen(true);
  }
  function openEdit(entry: LogEntry) {
    setEditingEntry(entry);
    setSheetOpen(true);
  }
  function closeSheet() {
    setSheetOpen(false);
    setEditingEntry(null);
  }

  const entries = dayLog.data?.entries ?? [];
  const totals = dayLog.data?.totals ?? EMPTY_TOTALS;

  const checkin = coachStatus.data?.latestCheckin;
  const targets =
    date === localDateString() && checkin
      ? {
          calories: checkin.targetCalories,
          proteinG: checkin.targetProteinG,
          fatG: checkin.targetFatG,
          carbsG: checkin.targetCarbsG,
        }
      : null;

  const groups = groupLogEntriesByTime(entries);

  return (
    <div className="min-h-dvh pb-24 bg-dashboardBg">
      <div className="sticky top-0 z-10 bg-dashboardBg">
        <header className="px-4 pt-5 pb-2 max-w-md mx-auto">
          <div className="grid grid-cols-3 items-center">
            <button
              onClick={() => setDate((d) => addDays(d, -1))}
              className="justify-self-start text-white/60 text-xl leading-none px-2 py-1"
              aria-label="Previous day"
            >
              ‹
            </button>
            <span className="flex flex-col items-center leading-tight">
              {authStatus.data?.user?.name && (
                <span className="text-[10px] tracking-widest uppercase text-muted">{authStatus.data.user.name}</span>
              )}
              <span className="text-sm font-medium text-white">{formatDayLabel(date)}</span>
            </span>
            <button
              onClick={() => setDate((d) => addDays(d, 1))}
              disabled={date === localDateString()}
              className="justify-self-end text-white/60 text-xl leading-none px-2 py-1 disabled:opacity-30"
              aria-label="Next day"
            >
              ›
            </button>
          </div>
          <div className="flex justify-end pt-0.5">
            <button onClick={() => setCopyOpen(true)} className="text-xs text-white/50">
              Copy a day
            </button>
          </div>
        </header>

        <div className="px-4 pb-3 max-w-md mx-auto">
          <MacroSummaryBar totals={totals} targets={targets} />
        </div>
      </div>

      <main className="px-4 pt-3 max-w-md mx-auto">
        {groups.length === 0 ? (
          <p className="text-sm text-muted text-center py-16">Nothing logged yet.</p>
        ) : (
          <div className="relative">
            <div className="absolute top-2 bottom-2 w-px bg-dashboardDivider" style={{ right: "18px" }} />
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.id} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0 space-y-2">
                    {group.entries.map((entry) => (
                      <FoodLogEntryCard
                        key={entry.id}
                        entry={entry}
                        onEdit={() => openEdit(entry)}
                        onDelete={() => deleteLog.mutate(entry.id)}
                      />
                    ))}
                  </div>
                  <div className="relative z-10 shrink-0 w-9 flex flex-col items-center pt-2">
                    <span className="h-2 w-2 rounded-full bg-white/30 ring-4 ring-dashboardBg" />
                    <span className="text-[9px] text-muted mt-1 text-center leading-tight">
                      {formatLogTime(group.entries[0].loggedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={openAdd}
          className="w-full mt-4 py-3 rounded-2xl border border-white/15 text-sm text-white/70 active:bg-dashboardCard"
        >
          + Log food
        </button>
      </main>

      <AddFoodSheet open={sheetOpen} date={date} editingEntry={editingEntry} onClose={closeSheet} />

      {copyOpen && <CopyDaySheet targetDate={date} onClose={() => setCopyOpen(false)} />}
    </div>
  );
}
