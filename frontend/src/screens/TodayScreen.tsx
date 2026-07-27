import { useState } from "react";
import { Copy } from "lucide-react";
import type { LogEntry } from "../api/types";
import { useDayLog, useDeleteLog } from "../api/logs";
import { useAuthStatus } from "../api/auth";
import { useCheckinHistory } from "../api/coach";
import { addDays, formatDayLabel, localDateString } from "../lib/date";
import { activeCheckinForDate } from "../lib/checkins";
import { groupLogEntriesByTime } from "../lib/logGrouping";
import MacroSummaryBar from "../components/MacroSummaryBar";
import TimeBlockGroup from "../components/TimeBlockGroup";
import AddFoodSheet from "../components/AddFoodSheet";
import CopyDaySheet from "../components/CopyDaySheet";

const EMPTY_TOTALS = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, saturatedFat: 0, sodiumMg: 0 };

// Blank-by-default timeline: no Breakfast/Lunch/Dinner/Snacks sections
// (removed app-wide — see backend/src/db/schema.ts and every route/hook that
// used to take a `meal`). Entries are grouped purely by how close together in
// time they were logged (lib/logGrouping.ts) into "time blocks" (see
// components/TimeBlockGroup.tsx) — each block gets one rolled-up macro
// header sharing a flex baseline with the block's timestamp node, plus its
// own dark food cards (components/FoodItemCard.tsx) underneath, with a
// shared timestamp per group acting as a node on the vertical timeline line
// down the right edge.
export default function TodayScreen() {
  const [date, setDate] = useState(localDateString());
  const dayLog = useDayLog(date);
  const deleteLog = useDeleteLog(date);
  const authStatus = useAuthStatus();
  const checkinHistory = useCheckinHistory();

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

  // Whichever check-in was active on the viewed date, not just today's latest
  // — same lookup NutrientDetailScreen/EnergyBalanceChart use, so a past
  // day's macro bars fill against the target that was actually in effect
  // then, rather than going target-less (and therefore permanently 0% full)
  // for every day except today.
  const checkinsAsc = [...(checkinHistory.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const activeCheckin = activeCheckinForDate(checkinsAsc, date);
  const targets = activeCheckin
    ? {
        calories: activeCheckin.targetCalories,
        proteinG: activeCheckin.targetProteinG,
        fatG: activeCheckin.targetFatG,
        carbsG: activeCheckin.targetCarbsG,
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
            <div className="justify-self-end flex items-center gap-1">
              <button
                onClick={() => setDate((d) => addDays(d, 1))}
                disabled={date === localDateString()}
                className="text-white/60 text-xl leading-none px-2 py-1 disabled:opacity-30"
                aria-label="Next day"
              >
                ›
              </button>
              <button
                onClick={() => setCopyOpen(true)}
                className="text-muted p-1.5 active:text-white/70"
                aria-label="Copy a day"
              >
                <Copy className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            </div>
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
            {/* TimeBlockGroup's dot is w-2 (8px) flush to this container's right edge, so its
                center sits 4px in from the edge. This 1px-wide line must start 0.5px further
                out (right: 3.5px) so its own center lands on that same 4px point. */}
            <div className="absolute top-2 bottom-2 w-px bg-dashboardDivider" style={{ right: "3.5px" }} />
            <div className="space-y-6">
              {groups.map((group) => (
                <TimeBlockGroup
                  key={group.id}
                  entries={group.entries}
                  onEdit={openEdit}
                  onDelete={(entry) => deleteLog.mutate(entry.id)}
                />
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

      <AddFoodSheet
        open={sheetOpen}
        date={date}
        editingEntry={editingEntry}
        onClose={closeSheet}
        totals={totals}
        targets={targets}
      />

      {copyOpen && <CopyDaySheet targetDate={date} onClose={() => setCopyOpen(false)} />}
    </div>
  );
}
