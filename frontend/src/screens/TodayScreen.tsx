import { useState } from "react";
import { Copy } from "lucide-react";
import type { LogEntry } from "../api/types";
import { useDayLog, useDeleteLog, useMoveLogEntries, useLoggedDates } from "../api/logs";
import { useAuthStatus } from "../api/auth";
import { usePrograms } from "../api/programs";
import { addDays, formatDayLabel, localDateString } from "../lib/date";
import { targetsForDate } from "../lib/programTargets";
import { groupLogEntriesByTime } from "../lib/logGrouping";
import MacroSummaryBar from "../components/MacroSummaryBar";
import TimeBlockGroup from "../components/TimeBlockGroup";
import AddFoodSheet from "../components/AddFoodSheet";
import CopyDaySheet from "../components/CopyDaySheet";
import CalendarJumpSheet from "../components/CalendarJumpSheet";
import LogActionBar, { type LogSelection } from "../components/LogActionBar";
import ConfirmDeleteSheet from "../components/ConfirmDeleteSheet";
import ShortcutsBar from "../components/ShortcutsBar";
import { staggerStyle } from "../lib/stagger";
import { useAnnounceViewedDate } from "../lib/viewedDate";

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
  // Lets the globally-rendered FAB (App.tsx's <BottomNav/>, outside this
  // screen entirely) and the pinned shortcuts both act on whatever day this
  // screen's own ‹/› nav is currently showing, instead of always defaulting
  // to real today — see lib/viewedDate.tsx.
  useAnnounceViewedDate(date);
  const dayLog = useDayLog(date);
  const deleteLog = useDeleteLog(date);
  const moveEntries = useMoveLogEntries();
  const authStatus = useAuthStatus();
  const programs = usePrograms();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LogEntry | null>(null);
  // Set when a group's own "+" button opens the sheet — forces whatever gets
  // logged there onto that group's exact loggedAt instead of "now", so it
  // joins/extends that same time-group. null for editing, which wants the
  // entry's own existing loggedAt instead (see openEdit). Adding a brand-new
  // entry from scratch goes through the global FAB/pinned shortcuts now
  // (QuickActionFlow, date-aware via lib/viewedDate.tsx) rather than a sheet
  // instance of this screen's own — this screen's own AddFoodSheet mount
  // below is reached only via editing or a group's quick-add.
  const [quickAddLoggedAt, setQuickAddLoggedAt] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<LogEntry | null>(null);
  const loggedDates = useLoggedDates(calendarOpen);
  const [selection, setSelection] = useState<LogSelection | null>(null);

  function openEdit(entry: LogEntry) {
    setEditingEntry(entry);
    setQuickAddLoggedAt(null);
    setSheetOpen(true);
  }
  function openQuickAddToGroup(groupEntries: LogEntry[]) {
    setEditingEntry(null);
    setQuickAddLoggedAt(groupEntries[0].loggedAt);
    setSheetOpen(true);
  }
  function closeSheet() {
    setSheetOpen(false);
    setEditingEntry(null);
    setQuickAddLoggedAt(null);
  }

  // Tapping a food row selects it (showing LogActionBar's Edit/Copy/Move/
  // Modify-timestamp shortcuts) rather than jumping straight to editing —
  // tapping the same entry again deselects. Tapping a group's shared
  // timestamp selects the whole group instead (Copy/Move/Modify
  // timestamp/Create recipe, no Edit — see LogActionBar).
  function selectEntry(entry: LogEntry) {
    setSelection((prev) => (prev?.kind === "entry" && prev.entry.id === entry.id ? null : { kind: "entry", entry }));
  }
  function selectGroup(groupEntries: LogEntry[]) {
    setSelection((prev) =>
      prev?.kind === "group" && prev.entries[0]?.id === groupEntries[0]?.id ? null : { kind: "group", entries: groupEntries }
    );
  }

  // Tapping another group's arrow while a group is selected — moves the
  // selected group's own entries onto the target group's shared timestamp,
  // merging them into one group.
  function mergeSelectedGroupInto(targetGroupEntries: LogEntry[]) {
    if (selection?.kind !== "group") return;
    moveEntries.mutate({ ids: selection.entries.map((e) => e.id), loggedAt: targetGroupEntries[0].loggedAt });
    setSelection(null);
  }

  const entries = dayLog.data?.entries ?? [];
  const totals = dayLog.data?.totals ?? EMPTY_TOTALS;

  // Whichever program was active on the viewed date, not just today's latest
  // — same lookup NutrientDetailScreen/EnergyBalanceChart use, so a past
  // day's macro bars fill against the target that was actually in effect
  // then, rather than going target-less (and therefore permanently 0% full)
  // for every day except today.
  const dayTargets = targetsForDate(programs.data ?? [], date);
  const targets = dayTargets
    ? { calories: dayTargets.calories, proteinG: dayTargets.proteinG, fatG: dayTargets.fatG, carbsG: dayTargets.carbsG }
    : null;

  const groups = groupLogEntriesByTime(entries);

  return (
    <div className="min-h-dvh pb-24 bg-dashboardBg">
      {/* Glass rather than the flat bg-dashboardBg this used to be — a fully
          opaque sticky header made content scrolling underneath disappear at
          a hard line right at its bottom edge instead of continuing softly
          out of view. bg-dashboardBg/70 + backdrop-blur-xl lets that content
          show through, blurred, instead of cutting off abruptly. */}
      <div className="sticky top-0 z-10 bg-dashboardBg/70 backdrop-blur-xl">
        <header className="px-4 pt-5 pb-2 max-w-md mx-auto">
          <div className="grid grid-cols-3 items-center">
            <button
              onClick={() => setDate((d) => addDays(d, -1))}
              className="justify-self-start text-white/60 text-xl leading-none px-2 py-1"
              aria-label="Previous day"
            >
              ‹
            </button>
            <button onClick={() => setCalendarOpen(true)} className="flex flex-col items-center leading-tight active:opacity-70">
              {authStatus.data?.user?.name && (
                <span className="text-[10px] tracking-widest uppercase text-muted">{authStatus.data.user.name}</span>
              )}
              <span className="text-sm font-medium text-white">{formatDayLabel(date)}</span>
            </button>
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
              {groups.map((group, i) => (
                <div key={group.id} className="tile-enter" style={staggerStyle(i, 60, 5)}>
                  <TimeBlockGroup
                    entries={group.entries}
                    selectedEntryId={selection?.kind === "entry" ? selection.entry.id : null}
                    groupSelected={selection?.kind === "group" && selection.entries[0]?.id === group.entries[0]?.id}
                    anyGroupSelected={selection?.kind === "group"}
                    onSelectEntry={selectEntry}
                    onSelectGroup={selectGroup}
                    onQuickAdd={openQuickAddToGroup}
                    onMergeInto={mergeSelectedGroupInto}
                    onDelete={(entry) => setPendingDeleteEntry(entry)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Hidden during a selection — LogActionBar takes this same fixed slot above BottomNav */}
      {!selection && <ShortcutsBar />}

      <AddFoodSheet
        open={sheetOpen}
        date={date}
        editingEntry={editingEntry}
        forcedLoggedAt={quickAddLoggedAt ?? undefined}
        onClose={closeSheet}
        totals={totals}
        targets={targets}
      />

      {copyOpen && <CopyDaySheet targetDate={date} onClose={() => setCopyOpen(false)} />}

      {calendarOpen && (
        <CalendarJumpSheet
          selectedDate={date}
          markedDates={loggedDates.data?.dates ?? []}
          onSelect={setDate}
          onClose={() => setCalendarOpen(false)}
        />
      )}

      {selection && (
        <LogActionBar
          selection={selection}
          sourceDate={date}
          onClose={() => setSelection(null)}
          onEdit={openEdit}
        />
      )}

      {pendingDeleteEntry && (
        <ConfirmDeleteSheet
          title="Delete Food"
          message={`Remove ${pendingDeleteEntry.food.name} from this day's log? This can't be undone.`}
          confirmLabel="Delete Food"
          onConfirm={() => deleteLog.mutate(pendingDeleteEntry.id, { onSuccess: () => setPendingDeleteEntry(null) })}
          onClose={() => setPendingDeleteEntry(null)}
          isPending={deleteLog.isPending}
        />
      )}
    </div>
  );
}
