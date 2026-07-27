import { Flame } from "lucide-react";
import type { LogEntry } from "../api/types";
import { formatLogTime } from "../lib/date";
import { sumGroupTotals } from "../lib/logGrouping";
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
  onEdit,
  onDelete,
}: {
  entries: LogEntry[];
  onEdit: (entry: LogEntry) => void;
  onDelete: (entry: LogEntry) => void;
}) {
  const totals = sumGroupTotals(entries);

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-2.5 text-[10px] text-muted tabular">
          <span className="flex items-center gap-0.5 shrink-0">
            <Flame className="w-3 h-3" strokeWidth={2} />
            {fmt(totals.calories)}
          </span>
          <span className="shrink-0">{fmt(totals.protein)}P</span>
          <span className="shrink-0">{fmt(totals.fat)}F</span>
          <span className="shrink-0">{fmt(totals.carbs)}C</span>
        </div>
        <div className="relative z-10 shrink-0 flex items-center gap-1.5">
          <span className="text-[9px] text-muted whitespace-nowrap">{formatLogTime(entries[0].loggedAt)}</span>
          <span className="h-2 w-2 rounded-full bg-white/30 ring-4 ring-dashboardBg shrink-0" />
        </div>
      </div>
      <div className="space-y-1 mt-1.5 pr-4">
        {entries.map((entry) => (
          <FoodItemCard key={entry.id} entry={entry} onEdit={() => onEdit(entry)} onDelete={() => onDelete(entry)} />
        ))}
      </div>
    </div>
  );
}
