import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, ChevronLeft, ChevronRight } from "lucide-react";
import type { LogEntry } from "../api/types";
import { useDayLog, useDeleteLog, useDeleteLogEntries, useMoveLogEntries, useLoggedDates } from "../api/logs";
import { usePrograms } from "../api/programs";
import { addDays, formatDayLabel, localDateString } from "../lib/date";
import { targetsForDate } from "../lib/programTargets";
import { groupLogEntriesByTime } from "../lib/logGrouping";
import MacroSummaryBar from "../components/MacroSummaryBar";
import TimeBlockGroup from "../components/TimeBlockGroup";
import AddFoodSheet from "../components/AddFoodSheet";
import CopyDaySheet from "../components/CopyDaySheet";
import DayMenuSheet from "../components/DayMenuSheet";
import CalendarJumpSheet from "../components/CalendarJumpSheet";
import LogActionBar, { type LogSelection } from "../components/LogActionBar";
import ConfirmDeleteSheet from "../components/ConfirmDeleteSheet";
import { useHideShortcutsBar } from "../lib/navVisibility";
import { staggerStyle } from "../lib/stagger";
import { useAnnounceViewedDate } from "../lib/viewedDate";

const EMPTY_TOTALS = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, saturatedFat: 0, sodiumMg: 0 };

// Must match LogActionBar's own transition-transform duration-200 — this is
// how long displaySelection below stays mounted with stale content after a
// real deselect, purely so LogActionBar has something to slide away with
// instead of unmounting mid-animation.
const SELECTION_BAR_EXIT_MS = 200;

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
  const deleteEntries = useDeleteLogEntries();
  const moveEntries = useMoveLogEntries();
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClearDay, setConfirmClearDay] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<LogEntry | null>(null);
  const loggedDates = useLoggedDates(calendarOpen);
  const [selection, setSelection] = useState<LogSelection | null>(null);
  // ShortcutsBar takes its same fixed slot above BottomNav for LogActionBar
  // while a selection is active — see useHideShortcutsBar's own comment for
  // why this goes through context now rather than just not rendering it.
  useHideShortcutsBar(!!selection);

  // Keeps LogActionBar mounted (with the last real selection) for one
  // transition's worth of time after deselecting, so it slides out with
  // its actual content instead of unmounting the instant `selection` goes
  // null and leaving nothing for the exit animation to show.
  const [displaySelection, setDisplaySelection] = useState<LogSelection | null>(null);
  useEffect(() => {
    if (selection) {
      setDisplaySelection(selection);
      return;
    }
    const timer = window.setTimeout(() => setDisplaySelection(null), SELECTION_BAR_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [selection]);

  function openEdit(entry: LogEntry) {
    setEditingEntry(entry);
    setQuickAddLoggedAt(null);
    setSheetOpen(true);
  }
  // useCallback here (and on the other handlers TimeBlockGroup receives)
  // isn't just tidiness: TimeBlockGroup is memoized specifically so a
  // selection toggle doesn't re-render every group in the day, and a
  // freshly-created function prop on every TodayScreen render would defeat
  // that for every group, not just the one that actually changed.
  const openQuickAddToGroup = useCallback((groupEntries: LogEntry[]) => {
    setEditingEntry(null);
    setQuickAddLoggedAt(groupEntries[0].loggedAt);
    setSheetOpen(true);
  }, []);
  function closeSheet() {
    setSheetOpen(false);
    setEditingEntry(null);
    setQuickAddLoggedAt(null);
  }

  // Tapping a food row toggles its selection in our multi-select list.
  const selectEntry = useCallback((entry: LogEntry) => {
    setSelection((prev) => {
      const current = prev ?? [];
      const exists = current.some((e) => e.id === entry.id);
      const next = exists ? current.filter((e) => e.id !== entry.id) : [...current, entry];
      return next.length > 0 ? next : null;
    });
  }, []);

  // Tapping a group's shared timestamp selects or deselects all entries in the group.
  const selectGroup = useCallback((groupEntries: LogEntry[]) => {
    setSelection((prev) => {
      const current = prev ?? [];
      const allSelected = groupEntries.every((ge) => current.some((c) => c.id === ge.id));
      let next: LogEntry[];
      if (allSelected) {
        // Deselect the group
        next = current.filter((c) => !groupEntries.some((ge) => ge.id === c.id));
      } else {
        // Select the group (add any entries that aren't already selected)
        const toAdd = groupEntries.filter((ge) => !current.some((c) => c.id === ge.id));
        next = [...current, ...toAdd];
      }
      return next.length > 0 ? next : null;
    });
  }, []);

  // Read via a ref rather than closed over directly: `selection` changes on
  // every single toggle, and this function is a shared prop on every
  // TimeBlockGroup, so if its identity changed every toggle too, the memo
  // bailout below would never fire for anyone.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Moves the selected entry or group of entries onto the target group's
  // shared timestamp, merging them into that group.
  const moveSelectedInto = useCallback((targetGroupEntries: LogEntry[]) => {
    const current = selectionRef.current;
    if (!current) return;
    const ids = current.map((e) => e.id);
    moveEntries.mutate({ ids, loggedAt: targetGroupEntries[0].loggedAt });
    setSelection(null);
  }, [moveEntries]);

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

  // useMemo (not a plain call) because this screen re-renders on every
  // selection toggle, and TimeBlockGroup below is memoized specifically to
  // skip re-rendering unaffected groups on those toggles — a fresh array of
  // fresh group objects every render would hand every group a new `entries`
  // reference regardless, defeating that memo for the whole day, not just
  // the group that changed.
  const groups = useMemo(() => groupLogEntriesByTime(entries), [entries]);

  return (
    <div className="min-h-dvh bg-dashboardBg">
      {/* Sticky header lives as a sibling of the rubber-band surface, not a
          descendant (found 2026-08-06) — pull-to-refresh silently did
          nothing on this screen specifically, the only data-rubber-band-surface
          screen with a position:sticky element inside it. useRubberBandScroll
          moves that surface with a live transform during a pull; Android
          Chrome/WebView's recalculation of a sticky element's stuck position
          under a transformed ancestor is unreliable enough in practice that
          the header (which visually dominates the top of this screen) just
          never appeared to move, reading as "nothing happens" even though
          the content below may have shifted correctly. Same reasoning as
          keeping the fixed LogActionBar out of this surface (see its own
          comment below) — anything from the header down that also isn't
          plain flow content stays out too. Bonus: this also matches how
          most native pull-to-refresh looks anyway (header stays pinned,
          only the content stretches beneath it). Sheets are portaled to
          body. */}
      {/* backdrop-blur-sm restored (2026-08-06) — dropping it entirely
          didn't fix the low-FPS bounce (tried, reverted same day), so the
          blur wasn't the actual cause; see useRubberBandScroll.ts for the
          real one (compositing layer promotion cost, not backdrop-filter).
          Translucent bg (not opaque) is what makes the blur visible at all.
          The bottom border mirrors BottomNav's own default top border (also
          border-dashboardDivider) — that component only hides its border
          when a docked bar sits above it so the two read as one surface;
          here the header borders real scrollable content directly, the
          same situation as BottomNav's own default, so it gets the same
          visible divider rather than no edge at all. */}
      {/* border opacity dropped to /50 (2026-08-06) — a full-strength divider
          next to a translucent blurred header read as a heavier, harder-edged
          line than the rest of this screen's soft aesthetic. Keeping some
          edge rather than dropping it outright: this still mirrors
          BottomNav's own rule (a visible edge whenever it borders real
          scrollable content, only hidden when another docked bar sits flush
          against it) — this header borders scrollable content directly, same
          situation. */}
      <div className="sticky top-0 z-10 bg-dashboardBg/85 backdrop-blur-sm border-b border-dashboardDivider/50">
        <header className="px-4 pt-4 pb-1.5 max-w-md mx-auto">
          <div className="grid grid-cols-3 items-center">
            <button
              onClick={() => setDate((d) => addDays(d, -1))}
              className="justify-self-start text-white/60 active:text-white p-1 -ml-1 flex items-center"
              aria-label="Previous day"
            >
              <ChevronLeft size={18} strokeWidth={2.2} />
            </button>
            <button onClick={() => setCalendarOpen(true)} className="justify-self-center active:opacity-70">
              <span className="text-sm font-medium text-white">{formatDayLabel(date)}</span>
            </button>
            <div className="justify-self-end flex items-center gap-1.5">
              {/* Only rendered off today — logging in advance means forward
                  nav (below) no longer stops there, so this is the fast way
                  back rather than tapping the date to open the whole
                  calendar sheet just to hit its own "Today" shortcut. */}
              {date !== localDateString() && (
                <button
                  onClick={() => setDate(localDateString())}
                  className="text-[11px] font-medium text-accent px-1.5 py-1 -my-1 active:opacity-70"
                  aria-label="Jump to today"
                >
                  Today
                </button>
              )}
              <button
                onClick={() => setDate((d) => addDays(d, 1))}
                className="text-white/60 active:text-white p-1 flex items-center"
                aria-label="Next day"
              >
                <ChevronRight size={18} strokeWidth={2.2} />
              </button>
              {/* Was a lone Copy icon — consolidated into one "Day actions"
                  menu (DayMenuSheet) alongside Select All/Clear Day, which
                  need an entry point that doesn't require anything already
                  selected. Net icon count in this header is unchanged. */}
              <button
                onClick={() => setMenuOpen(true)}
                className="text-muted p-1.5 active:text-white/70"
                aria-label="Day actions"
              >
                <MoreHorizontal className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        </header>

        {/* No longer collapses on scroll (removed 2026-08-06) — the
            grid-template-rows collapse animation running on every scroll
            direction change was a suspected contributor to scroll stutter
            on this screen; always showing this is also simpler than a
            transition that had to fight for scroll-event priority with
            ShortcutsBar's own independent useHideOnScroll instance (see
            navVisibility's suppressScrollHide, no longer needed here). */}
        <div className="px-4 pb-2 max-w-md mx-auto">
          <MacroSummaryBar totals={totals} targets={targets} />
        </div>
      </div>

      {/* This content-only surface can use compositor transforms for the
          rubber-band without turning the fixed selection bar below into a
          descendant containing block — see the header comment above for why
          the sticky header itself is a sibling, not wrapped in here too. No
          min-h-dvh here (unlike the other data-rubber-band-surface screens):
          the outer div above already guarantees the page is at least one
          viewport tall, and this surface no longer needs to cover the
          header's own height on top of that. */}
      <div data-rubber-band-surface className="pb-40 bg-dashboardBg">
      <main className="px-4 pt-3 max-w-md mx-auto">
        {groups.length === 0 ? (
          <p className="text-sm text-muted text-center py-16">Nothing logged yet.</p>
        ) : (
          <div className="relative">
            {/* TimeBlockGroup's dot is w-2 (8px) flush to this container's right edge, so its
                center sits 4px in from the edge. This 1px-wide line must start 0.5px further
                out (right: 3.5px) so its own center lands on that same 4px point. */}
            <div className="absolute top-2 bottom-2 w-px bg-dashboardDivider" style={{ right: "27px" }} />
            <div className="space-y-6">
              {groups.map((group, i) => {
                // A string, not a filtered array: unaffected groups get the
                // exact same primitive value on every render (see
                // TimeBlockGroup's own comment on why that matters for its
                // memo to actually skip work).
                const selectedMask = selection
                  ? group.entries.map((e) => (selection.some((s) => s.id === e.id) ? "1" : "0")).join("")
                  : "";
                const groupSelected = selectedMask.length > 0 && !selectedMask.includes("0");
                return (
                  <div key={group.id} className="tile-enter" style={staggerStyle(i, 60, 5)}>
                    <TimeBlockGroup
                      entries={group.entries}
                      selectedMask={selectedMask}
                      groupSelected={groupSelected}
                      anySelected={!!selection}
                      onSelectEntry={selectEntry}
                      onSelectGroup={selectGroup}
                      onQuickAdd={openQuickAddToGroup}
                      onMergeInto={moveSelectedInto}
                      onDelete={setPendingDeleteEntry}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
      </div>

      <AddFoodSheet
        open={sheetOpen}
        date={date}
        editingEntry={editingEntry}
        initialStep={quickAddLoggedAt ? "search" : undefined}
        forcedLoggedAt={quickAddLoggedAt ?? undefined}
        onClose={closeSheet}
        totals={totals}
        targets={targets}
      />

      {copyOpen && <CopyDaySheet targetDate={date} onClose={() => setCopyOpen(false)} />}

      {menuOpen && (
        <DayMenuSheet
          hasEntries={entries.length > 0}
          onSelectAll={() => setSelection(entries)}
          onCopyDay={() => setCopyOpen(true)}
          onClearDay={() => setConfirmClearDay(true)}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {confirmClearDay && (
        <ConfirmDeleteSheet
          title="Clear Day"
          message={`Remove all ${entries.length} food ${entries.length === 1 ? "entry" : "entries"} logged on ${formatDayLabel(
            date
          )}? This can't be undone.`}
          confirmLabel="Clear Day"
          onConfirm={() =>
            deleteEntries.mutate(
              entries.map((e) => e.id),
              { onSuccess: () => setConfirmClearDay(false) }
            )
          }
          onClose={() => setConfirmClearDay(false)}
          isPending={deleteEntries.isPending}
        />
      )}

      {calendarOpen && (
        <CalendarJumpSheet
          selectedDate={date}
          markedDates={loggedDates.data?.dates ?? []}
          onSelect={setDate}
          onClose={() => setCalendarOpen(false)}
          allowFuture
        />
      )}

      {displaySelection && (
        <div data-no-rubber-band>
          <LogActionBar
            selection={displaySelection}
            active={!!selection}
            sourceDate={date}
            onClose={() => setSelection(null)}
            onEdit={openEdit}
          />
        </div>
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
