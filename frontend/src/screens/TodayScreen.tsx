import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useHideOnScroll from "../lib/useHideOnScroll";
import { Copy, ChevronLeft, ChevronRight } from "lucide-react";
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
import { useHideShortcutsBar, useNavVisibility } from "../lib/navVisibility";
import { staggerStyle } from "../lib/stagger";
import { useAnnounceViewedDate } from "../lib/viewedDate";

const EMPTY_TOTALS = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, saturatedFat: 0, sodiumMg: 0 };

// Must match LogActionBar's own transition-transform duration-200 — this is
// how long displaySelection below stays mounted with stale content after a
// real deselect, purely so LogActionBar has something to slide away with
// instead of unmounting mid-animation.
const SELECTION_BAR_EXIT_MS = 200;

// Must be >= the macro summary's own transition-[grid-template-rows]
// duration-200 below — a small buffer past the CSS transition's own 200ms
// so the scroll-suppression window (see suppressScrollHide below) outlasts
// the animation itself rather than lapsing a frame or two early.
const MACRO_COLLAPSE_TRANSITION_MS = 260;

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
  // ShortcutsBar takes its same fixed slot above BottomNav for LogActionBar
  // while a selection is active — see useHideShortcutsBar's own comment for
  // why this goes through context now rather than just not rendering it.
  useHideShortcutsBar(!!selection);
  // Same scroll-hide signal ShortcutsBar already uses (its own separate
  // call, not shared state — both react to the same real scroll and land in
  // sync). The macro summary is the tallest part of this screen's sticky
  // header, permanently claiming close to a fifth of the screen on a tab
  // that's fundamentally a list; collapsing it away while actively browsing
  // and bringing it back on scroll-up (or near the top) reclaims that
  // space without losing quick access to it.
  const macroSummaryVisible = useHideOnScroll();
  // This collapse animates the header's real height over
  // MACRO_COLLAPSE_TRANSITION_MS — long enough for the resulting scrollY
  // correction (see navVisibility's own comment on suppressScrollHide) to
  // read as a sustained, multi-frame, real-looking scroll gesture, not just
  // a single stray sample. Every useHideOnScroll instance app-wide
  // (including ShortcutsBar's own, independent call) needs to ignore scroll
  // input for the full transition, not just this screen's own — that's why
  // this goes through shared context instead of a local guard.
  const { suppressScrollHide } = useNavVisibility();
  const macroSummaryVisiblePrevRef = useRef(macroSummaryVisible);
  useEffect(() => {
    if (macroSummaryVisiblePrevRef.current === macroSummaryVisible) return;
    macroSummaryVisiblePrevRef.current = macroSummaryVisible;
    suppressScrollHide(MACRO_COLLAPSE_TRANSITION_MS);
  }, [macroSummaryVisible, suppressScrollHide]);

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
      {/* This content-only surface can use compositor transforms for the
          rubber-band without turning the fixed selection bar below into a
          descendant containing block. Sheets are portaled to body. */}
      <div data-rubber-band-surface className="min-h-dvh pb-40 bg-dashboardBg">
      {/* Solid, not glass: backdrop-blur-xl here used to recomposite every
          scroll frame based on whatever was scrolling underneath it, since
          this header is sticky and blur can't be cached like a flat fill —
          a real, measurable cost on every frame of food-log scrolling, not
          just an occasional one. Loses the soft fade-under-header look for
          a plain cutoff; worth it since this is the one sticky+blur header
          in the app sitting directly above the screen's own scroll content
          (contrast BarcodeScanner's blur, which is on static controls, not
          something continuously repainted by scrolling). The bottom border
          mirrors BottomNav's own default top border (also
          border-dashboardDivider) — that component only hides its border
          when a docked bar sits above it so the two read as one surface;
          here the header borders real scrollable content directly, the
          same situation as BottomNav's own default, so it gets the same
          visible divider rather than no edge at all. */}
      <div className="sticky top-0 z-10 bg-dashboardBg border-b border-dashboardDivider">
        <header className="px-4 pt-5 pb-2 max-w-md mx-auto">
          <div className="grid grid-cols-3 items-center">
            <button
              onClick={() => setDate((d) => addDays(d, -1))}
              className="justify-self-start text-white/60 active:text-white p-1 -ml-1 flex items-center"
              aria-label="Previous day"
            >
              <ChevronLeft size={18} strokeWidth={2.2} />
            </button>
            <button onClick={() => setCalendarOpen(true)} className="flex flex-col items-center leading-tight active:opacity-70">
              {authStatus.data?.user?.name && (
                <span className="text-[10px] tracking-widest uppercase text-muted">{authStatus.data.user.name}</span>
              )}
              <span className="text-sm font-medium text-white">{formatDayLabel(date)}</span>
            </button>
            <div className="justify-self-end flex items-center gap-1.5">
              <button
                onClick={() => setDate((d) => addDays(d, 1))}
                disabled={date === localDateString()}
                className="text-white/60 active:text-white p-1 flex items-center disabled:opacity-30 disabled:pointer-events-none"
                aria-label="Next day"
              >
                <ChevronRight size={18} strokeWidth={2.2} />
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

        {/* Same collapse mechanic as AddFoodSheet's own ActionBar (grid-rows
            0fr/1fr, not a conditional unmount) — see that component's own
            comment. A conditional unmount would restart MacroSummaryBar's
            own internal state (its swipeable page position) on every
            collapse/reveal; this only changes the space it's given. */}
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: macroSummaryVisible ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div className="px-4 pb-3 max-w-md mx-auto">
              <MacroSummaryBar totals={totals} targets={targets} />
            </div>
          </div>
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

      {calendarOpen && (
        <CalendarJumpSheet
          selectedDate={date}
          markedDates={loggedDates.data?.dates ?? []}
          onSelect={setDate}
          onClose={() => setCalendarOpen(false)}
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
