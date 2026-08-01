import { useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { localDateString } from "../lib/date";
import BottomSheet from "./BottomSheet";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// A plain tap-a-row list in a BottomSheet — same visual language as every
// other picker sheet in the app (CalendarJumpSheet's month nav, the Quick
// Actions edit list) rather than a native OS `<select>`, which renders as a
// bright system picker wheel that looks jarringly out of place in this
// hand-built dark UI. Shared by both the month and year triggers below since
// "tap one option from a list" is the same interaction either way.
function OptionPickerSheet({
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  title: string;
  options: { value: number; label: string }[];
  selected: number;
  onSelect: (value: number) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[70%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
            <span className="text-sm font-medium">{title}</span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <div className="rounded-2xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider">
              {options.map((o) => (
                <button
                  key={o.value}
                  onClick={() => {
                    onSelect(o.value);
                    close();
                  }}
                  className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-surface-raised"
                >
                  <span className={`text-sm ${o.value === selected ? "text-accent" : ""}`}>{o.label}</span>
                  {o.value === selected && <Check className="w-4 h-4 text-accent" strokeWidth={2} />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function MonthGrid({
  year,
  month,
  activeDates,
  today,
  onPrevMonth,
  onNextMonth,
  canGoPrev,
  canGoNext,
  onSelectMonth,
  onSelectYear,
  yearOptions,
}: {
  year: number;
  month: number;
  activeDates: Set<string>;
  today: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  onSelectMonth: (month: number) => void;
  onSelectYear: (year: number) => void;
  yearOptions: number[];
}) {
  const [picker, setPicker] = useState<"month" | "year" | null>(null);
  const firstDow = new Date(year, month, 1).getDay();
  const numDays = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: numDays }, (_, i) => toDateStr(year, month, i + 1)),
  ];

  return (
    <div className="max-w-[320px] mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onPrevMonth}
            disabled={!canGoPrev}
            aria-label="Previous month"
            className="flex items-center justify-center w-7 h-7 rounded-full border border-line text-muted shrink-0 disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            disabled={!canGoNext}
            aria-label="Next month"
            className="flex items-center justify-center w-7 h-7 rounded-full border border-line text-muted shrink-0 disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setPicker("month")}
          className="flex-1 min-w-0 flex items-center justify-center gap-1 rounded-full border border-line px-3 py-1.5 text-sm"
        >
          <span className="truncate">{MONTH_NAMES[month]}</span>
          <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={() => setPicker("year")}
          className="shrink-0 flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-sm"
        >
          <span>{year}</span>
          <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={2} />
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
          const active = activeDates.has(date);
          const isToday = date === today;
          return (
            <div key={date} className="aspect-square flex items-center justify-center" title={date}>
              <span
                className={`w-full h-full rounded-md flex items-center justify-center text-xs tabular ${
                  active ? "bg-accent" : "bg-surface-raised text-muted"
                } ${isToday ? "ring-1 ring-accent" : ""}`}
                style={active ? { color: "#0B1210" } : undefined}
              >
                {dayNum}
              </span>
            </div>
          );
        })}
      </div>

      {picker === "month" && (
        <OptionPickerSheet
          title="Select Month"
          options={MONTH_NAMES.map((label, i) => ({ value: i, label }))}
          selected={month}
          onSelect={onSelectMonth}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "year" && (
        <OptionPickerSheet
          title="Select Year"
          options={yearOptions.map((y) => ({ value: y, label: String(y) }))}
          selected={year}
          onSelect={onSelectYear}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// GitHub-contribution-style grid: weeks as columns, Sun-Sat as rows. Binary
// presence only (no magnitude), matching MonthGrid and HabitStrip above.
function YearHeatmap({ year, activeDates }: { year: number; activeDates: Set<string> }) {
  const startDow = new Date(year, 0, 1).getDay();
  const totalDays = isLeapYear(year) ? 366 : 365;
  const numWeeks = Math.ceil((startDow + totalDays) / 7);

  const weeks: (string | null)[][] = Array.from({ length: numWeeks }, () => Array(7).fill(null));
  for (let i = 0; i < totalDays; i++) {
    const date = new Date(year, 0, 1 + i);
    const dow = date.getDay();
    const weekIdx = Math.floor((startDow + i) / 7);
    weeks[weekIdx][dow] = localDateString(date);
  }

  return (
    <div>
      <p className="text-sm font-medium mb-2">{year}</p>
      <div className="flex gap-[2px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex-1 min-w-0 flex flex-col gap-[2px]">
            {week.map((date, di) => (
              <div
                key={di}
                title={date ?? undefined}
                className={`aspect-square rounded-sm ${date && activeDates.has(date) ? "bg-accent" : "bg-surface-raised"}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export default function ConsistencyCalendar({ activeDates }: { activeDates: Set<string> }) {
  const today = localDateString();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const years = [...activeDates].map((d) => Number(d.slice(0, 4)));
  const earliestYear = years.length > 0 ? Math.min(...years) : currentYear;
  // Includes the current year (not just prior ones) — otherwise earlier
  // months in the same year (e.g. June, if it's now July) would have no view
  // at all: not "this month," and not a "previous year" either.
  const yearViews: number[] = [];
  for (let y = currentYear; y >= earliestYear; y--) yearViews.push(y);

  // Local view state for the month grid — separate from `currentYear`/
  // `currentMonth` above, which stay pinned to "now" so bounds checks (can't
  // page past the current month, into a year with no tracked data) always
  // compare against the real present rather than wherever the grid is
  // currently scrolled to.
  const [viewed, setViewed] = useState({ year: currentYear, month: currentMonth });
  const atCurrentMonth = viewed.year === currentYear && viewed.month === currentMonth;
  const atEarliestMonth = viewed.year === earliestYear && viewed.month === 0;

  function goPrevMonth() {
    setViewed((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }));
  }
  function goNextMonth() {
    setViewed((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }));
  }
  function selectMonth(month: number) {
    setViewed((v) => {
      // Clamp rather than reject — picking a future month within the
      // current year snaps to the current month instead of silently no-op'ing.
      if (v.year === currentYear && month > currentMonth) return { year: v.year, month: currentMonth };
      return { year: v.year, month };
    });
  }
  function selectYear(year: number) {
    setViewed((v) => ({ year, month: year === currentYear ? Math.min(v.month, currentMonth) : v.month }));
  }

  return (
    <div className="space-y-6">
      <MonthGrid
        year={viewed.year}
        month={viewed.month}
        activeDates={activeDates}
        today={today}
        onPrevMonth={goPrevMonth}
        onNextMonth={goNextMonth}
        canGoPrev={!atEarliestMonth}
        canGoNext={!atCurrentMonth}
        onSelectMonth={selectMonth}
        onSelectYear={selectYear}
        yearOptions={yearViews}
      />

      <div className="border border-line bg-surface rounded-2xl p-4">
        <div className="flex items-center justify-center gap-6 text-xs text-muted">
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-accent" />
            Tracked
          </span>
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full border border-line" />
            Untracked
          </span>
        </div>
      </div>

      {yearViews.length > 0 && (
        <div className="space-y-4">
          {yearViews.map((y) => (
            <YearHeatmap key={y} year={y} activeDates={activeDates} />
          ))}
        </div>
      )}
    </div>
  );
}
