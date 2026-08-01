import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { localDateString } from "../lib/date";
import BottomSheet from "./BottomSheet";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

// Shared jump-to-any-day picker — originally built for the Food Log's
// "Today"/"Yesterday"/"Wed, Jul 29" header (a jump target rather than only
// stepping one day at a time via the ‹ › arrows already next to it), now
// reused anywhere else a screen needs the same "pick a date" gesture (e.g.
// Photos' Date Taken field) rather than forking a near-identical component.
// A single navigable month grid (not ConsistencyCalendar's whole-history
// heatmap — that one's read-only and shows everything at once; this one's
// for quickly landing on one specific day and closing), with a small dot
// under days present in `markedDates` so blank stretches are visible at a
// glance while picking. Deliberately just a `string[]` prop rather than this
// component calling its own data hook — what "marked" means (a day with food
// logged, a day with a photo/measurement, etc.) is caller-specific.
export default function CalendarJumpSheet({
  selectedDate,
  markedDates,
  onSelect,
  onClose,
}: {
  selectedDate: string;
  markedDates: string[];
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  const [y, m] = selectedDate.split("-").map(Number);
  const [viewYear, setViewYear] = useState(y);
  const [viewMonth, setViewMonth] = useState(m - 1);
  const today = localDateString();

  const markedSet = new Set(markedDates);

  function shiftMonth(delta: number) {
    let nm = viewMonth + delta;
    let ny = viewYear;
    if (nm < 0) {
      nm = 11;
      ny -= 1;
    } else if (nm > 11) {
      nm = 0;
      ny += 1;
    }
    setViewMonth(nm);
    setViewYear(ny);
  }

  function pick(date: string, close: () => void) {
    onSelect(date);
    close();
  }

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const numDays = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: numDays }, (_, i) => toDateStr(viewYear, viewMonth, i + 1)),
  ];
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  // Disallow paging past the current month — there's nothing logged in the
  // future, and the ›› arrow elsewhere in this screen already stops at today.
  const atCurrentMonth = viewYear === Number(today.slice(0, 4)) && viewMonth === Number(today.slice(5, 7)) - 1;

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/60"
      panelClassName="bg-dashboardBg rounded-t-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers, close) => (
        <>
          {/* A button inside the drag-handle row is safe — BottomSheet's
              dragHandlers use a commit-threshold so a plain tap (no
              sustained movement) still fires the click normally; only an
              actual sustained drag takes over as the dismiss gesture. */}
          <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center justify-between shrink-0 touch-none">
            <span className="text-sm font-medium text-white">Jump to a day</span>
            {!(atCurrentMonth && selectedDate === today) && (
              <button
                onClick={() => {
                  setViewYear(Number(today.slice(0, 4)));
                  setViewMonth(Number(today.slice(5, 7)) - 1);
                  pick(today, close);
                }}
                className="text-xs font-medium text-accent"
              >
                Today
              </button>
            )}
          </div>

          <div className="px-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
                className="h-8 w-8 flex items-center justify-center rounded-full text-muted active:bg-white/10 active:text-white"
              >
                <ChevronLeft className="w-4 h-4" strokeWidth={2} />
              </button>
              <p className="text-sm font-medium text-white">{monthLabel}</p>
              <button
                onClick={() => shiftMonth(1)}
                disabled={atCurrentMonth}
                aria-label="Next month"
                className="h-8 w-8 flex items-center justify-center rounded-full text-muted active:bg-white/10 active:text-white disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAY_LABELS.map((d, i) => (
                <div key={i} className="text-[10px] text-muted pb-1">
                  {d}
                </div>
              ))}
              {cells.map((date, i) => {
                if (!date) return <div key={i} />;
                const dayNum = Number(date.slice(-2));
                const isSelected = date === selectedDate;
                const isToday = date === today;
                const isFuture = date > today;
                const hasEntries = markedSet.has(date);
                return (
                  <button
                    key={date}
                    onClick={() => pick(date, close)}
                    disabled={isFuture}
                    className="aspect-square flex flex-col items-center justify-center gap-0.5 disabled:opacity-30"
                  >
                    <span
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs tabular ${
                        isSelected ? "bg-accent" : isToday ? "ring-1 ring-accent text-white" : "text-white"
                      }`}
                      style={isSelected ? { color: "#0B1210" } : undefined}
                    >
                      {dayNum}
                    </span>
                    <span className={`w-1 h-1 rounded-full ${hasEntries && !isSelected ? "bg-accent" : "bg-transparent"}`} />
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
