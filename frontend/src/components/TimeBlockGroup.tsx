import { memo, useEffect, useState } from "react";
import { Flame, Plus, ArrowRight, Check } from "lucide-react";
import type { LogEntry } from "../api/types";
import { formatLogTime } from "../lib/date";
import { sumGroupTotals } from "../lib/logGrouping";
import { useEnergyUnit, kcalToUnit } from "../lib/energyUnit";
import FoodItemCard from "./FoodItemCard";

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

// The rolled-up macro header and the timestamp/dot node are siblings in one
// `items-center` flex row (not stacked in separate columns), so they land on
// the same vertical center regardless of how wide the formatted time string
// is. The timestamp+dot block is the row's last child with nothing after it,
// so its right edge always lands flush on the row's own right edge — that's
// what lets TodayScreen's absolute timeline line use one fixed `right`
// offset that lines up with every block's dot, independent of that block's
// time-string length ("7 AM" vs "12:45 PM").
// Memoized because TodayScreen re-renders this whole list on every selection
// toggle (React state can't change without a new top-level render) — without
// this, checking one food re-rendered every group and every card for the
// entire day, not just the one that changed. `selectedMask` (a "1010"-style
// string, one char per entry, computed by the caller) is what makes the
// memo bailout actually work: unaffected groups get the exact same string
// value each render (primitive equality, unlike a freshly-filtered array,
// which would be a new reference every time even with identical contents).
// `entries` staying reference-stable across a selection-only re-render
// requires the caller to useMemo() groupLogEntriesByTime's result — see
// TodayScreen's own comment on `groups`.
const TimeBlockGroup = memo(function TimeBlockGroup({
  entries,
  selectedMask,
  groupSelected,
  anySelected,
  onSelectEntry,
  onSelectGroup,
  onQuickAdd,
  onMergeInto,
  onDelete,
}: {
  entries: LogEntry[];
  // One char per entry in `entries`, same order — "1" selected, "0" not.
  selectedMask: string;
  groupSelected: boolean;
  // True while some group or entry is selected — every group's
  // left-of-timestamp button switches from "+" to a move/merge arrow while
  // this is true.
  anySelected: boolean;
  onSelectEntry: (entry: LogEntry) => void;
  onSelectGroup: (entries: LogEntry[]) => void;
  // "+" tap (only shown when no group is selected) — opens the add-food
  // sheet scoped to this group's own time, so a forgotten item can be added
  // to this meal with zero extra friction.
  onQuickAdd: (entries: LogEntry[]) => void;
  // Arrow tap on a *different* group while one is selected — moves the
  // selected items (group or single entry) to this group's time, merging them.
  onMergeInto: (entries: LogEntry[]) => void;
  onDelete: (entry: LogEntry) => void;
}) {
  const totals = sumGroupTotals(entries);
  const { unit: energyUnit } = useEnergyUnit();

  // Disable the merge/move target button if this group is either the selected group
  // or contains any of the selected entries (since moving them here is a no-op).
  const isOrigin = groupSelected || selectedMask.includes("1");

  // Which row (if any) currently has its swipe-to-delete action revealed —
  // scoped to this one group rather than lifted to TodayScreen, so opening a
  // swipe elsewhere on the day doesn't invalidate every other group's memo
  // bailout (see this component's own comment above on why that matters).
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  useEffect(() => {
    if (anySelected) setOpenSwipeId(null);
  }, [anySelected]);

  return (
    // A soft low-opacity fill on this whole container (rather than a ring/
    // border here plus one on every card inside, which read as messy) is the
    // group's selected indicator. `-mx-2 px-2` cancel out horizontally so
    // the timestamp dot's x-position never moves (TodayScreen's absolute
    // timeline line is calibrated against it) regardless of selection state;
    // `py-2` only applies when selected, so the wash gets real breathing
    // room above/below the header and last card instead of hiding behind
    // their own opaque backgrounds with nothing but a sliver showing through
    // the gaps. Cards themselves stay visually untouched by group selection
    // (see selected prop below) — only a genuinely single-selected entry
    // gets its own wash.
    <div
      className={`rounded-2xl -mx-2 px-2 border transition-all duration-150 ${
        groupSelected ? "bg-accent/[0.08] border-accent/15 py-2" : "border-transparent"
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="shrink-0 min-w-0 flex items-center gap-2.5 text-[10px] text-muted tabular bg-white/5 rounded-full px-2.5 py-1.5">
          {/* Letter-prefix (P119, not 119P) to match MacroSummaryBar's own
              convention above — this pill and the sticky header used to
              disagree with each other on which side of the number the
              letter goes. Only the flame/letter carries the macro color,
              the value itself stays plain white — also matching
              MacroSummaryBar, which colors just its icon/letter and leaves
              its number white. This pill used to color the whole span
              (letter+number together), a second disagreement between the
              two on top of the ordering one. */}
          <span className="flex items-center gap-0.5 shrink-0">
            <Flame className="w-3 h-3 text-calories" strokeWidth={2} />
            <span className="text-white">{fmt(kcalToUnit(totals.calories, energyUnit))}</span>
          </span>
          <span className="shrink-0">
            <span className="text-protein">P</span>
            <span className="text-white">{fmt(totals.protein)}</span>
          </span>
          <span className="shrink-0">
            <span className="text-fat">F</span>
            <span className="text-white">{fmt(totals.fat)}</span>
          </span>
          <span className="shrink-0">
            <span className="text-carbs">C</span>
            <span className="text-white">{fmt(totals.carbs)}</span>
          </span>
        </div>
        <div className="flex-1" />
        {anySelected ? (
          <button
            type="button"
            onClick={() => !isOrigin && onMergeInto(entries)}
            disabled={isOrigin}
            aria-label={isOrigin ? "Origin group" : "Move selected foods here"}
            className={`shrink-0 p-1.5 -m-0.5 rounded-full ${
              isOrigin ? "text-white opacity-[0.15] pointer-events-none" : "bg-white/5 text-muted active:text-white"
            }`}
          >
            <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.5} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onQuickAdd(entries)}
            aria-label="Add a food to this time"
            className="shrink-0 p-1.5 -m-0.5 rounded-full bg-white/5 text-muted active:text-white"
          >
            <Plus className="w-4 h-4" strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          onClick={() => onSelectGroup(entries)}
          aria-label="Select this time group"
          className="relative z-10 shrink-0 w-[54px] flex items-center justify-center -my-1 py-1"
        >
          <span
            className={`text-[9px] font-semibold whitespace-nowrap rounded-full px-2 py-1 transition-all ${
              groupSelected ? "bg-accent text-white" : "bg-dashboardChip text-muted"
            }`}
          >
            {formatLogTime(entries[0].loggedAt)}
          </span>
        </button>
      </div>
      <div className="space-y-1 mt-1.5 pr-14">
        {entries.map((entry, idx) => {
          const isChecked = selectedMask[idx] === "1";
          return (
            <div key={entry.id} className="relative">
              <FoodItemCard
                entry={entry}
                selected={isChecked}
                swipeEnabled={!anySelected}
                open={openSwipeId === entry.id}
                onOpenChange={(nextOpen) => setOpenSwipeId(nextOpen ? entry.id : null)}
                onSelect={() => onSelectEntry(entry)}
                onDelete={() => onDelete(entry)}
              />
              {anySelected && (
                <button
                  type="button"
                  onClick={() => onSelectEntry(entry)}
                  className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center"
                  style={{ right: "-29px", transform: "translate(50%, -50%)" }}
                  aria-label={isChecked ? "Deselect this food" : "Select this food"}
                >
                  {isChecked ? (
                    <div className="w-[18px] h-[18px] rounded-full bg-accent flex items-center justify-center text-white ring-2 ring-dashboardBg shadow-md">
                      <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                    </div>
                  ) : (
                    <div className="w-[18px] h-[18px] rounded-full border border-white/20 bg-dashboardBg ring-2 ring-dashboardBg hover:border-white/40 transition-colors" />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default TimeBlockGroup;
