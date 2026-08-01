import { Flame, Plus, ArrowRight } from "lucide-react";
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
export default function TimeBlockGroup({
  entries,
  selectedEntryId,
  groupSelected,
  anyGroupSelected,
  onSelectEntry,
  onSelectGroup,
  onQuickAdd,
  onMergeInto,
  onDelete,
}: {
  entries: LogEntry[];
  selectedEntryId: string | null;
  groupSelected: boolean;
  // True while some group (this one or another) is selected — every group's
  // left-of-timestamp button switches from "+" to a move/merge arrow while
  // this is true, per TodayScreen's "select a group, then tap another
  // group's arrow to merge them" flow.
  anyGroupSelected: boolean;
  onSelectEntry: (entry: LogEntry) => void;
  onSelectGroup: (entries: LogEntry[]) => void;
  // "+" tap (only shown when no group is selected) — opens the add-food
  // sheet scoped to this group's own time, so a forgotten item can be added
  // to this meal with zero extra friction.
  onQuickAdd: (entries: LogEntry[]) => void;
  // Arrow tap on a *different* group while one is selected — moves the
  // selected group's entries to this group's time, merging them together.
  onMergeInto: (entries: LogEntry[]) => void;
  onDelete: (entry: LogEntry) => void;
}) {
  const totals = sumGroupTotals(entries);
  const { unit: energyUnit } = useEnergyUnit();

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
      className={`rounded-2xl -mx-2 px-2 transition-[background-color,padding] duration-150 ${
        groupSelected ? "bg-accent/[0.14] py-2" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="shrink-0 min-w-0 flex items-center gap-2.5 text-[10px] text-muted tabular bg-white/5 rounded-full px-2.5 py-1.5">
          <span className="flex items-center gap-0.5 shrink-0">
            <Flame className="w-3 h-3" strokeWidth={2} />
            {fmt(kcalToUnit(totals.calories, energyUnit))}
          </span>
          <span className="shrink-0">{fmt(totals.protein)}P</span>
          <span className="shrink-0">{fmt(totals.fat)}F</span>
          <span className="shrink-0">{fmt(totals.carbs)}C</span>
        </div>
        <div className="flex-1" />
        {anyGroupSelected ? (
          <button
            type="button"
            onClick={() => !groupSelected && onMergeInto(entries)}
            disabled={groupSelected}
            aria-label={groupSelected ? "This is the selected time group" : "Move selected foods here"}
            className={`shrink-0 p-1.5 -m-0.5 rounded-full ${groupSelected ? "text-white/15" : "bg-white/5 text-muted active:text-white"}`}
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
          className="relative z-10 shrink-0 flex items-center gap-1.5 -m-1 p-1"
        >
          <span
            className={`text-[9px] whitespace-nowrap rounded-full px-2 py-1 ${
              groupSelected ? "bg-accent/15 text-white" : "bg-white/5 text-muted"
            }`}
          >
            {formatLogTime(entries[0].loggedAt)}
          </span>
          <span
            className={`h-2 w-2 rounded-full ring-4 ring-dashboardBg shrink-0 ${
              groupSelected ? "bg-accent" : "bg-muted"
            }`}
          />
        </button>
      </div>
      <div className="space-y-1 mt-1.5 pr-4">
        {entries.map((entry) => (
          <FoodItemCard
            key={entry.id}
            entry={entry}
            selected={selectedEntryId === entry.id}
            onSelect={() => onSelectEntry(entry)}
            onDelete={() => onDelete(entry)}
          />
        ))}
      </div>
    </div>
  );
}
