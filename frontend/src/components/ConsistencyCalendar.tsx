import { localDateString } from "../lib/date";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

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
}: {
  year: number;
  month: number;
  activeDates: Set<string>;
  today: string;
}) {
  const firstDow = new Date(year, month, 1).getDay();
  const numDays = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: numDays }, (_, i) => toDateStr(year, month, i + 1)),
  ];
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div>
      <p className="text-sm font-medium mb-2">{monthLabel}</p>
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
                className={`w-full h-full rounded-full flex items-center justify-center text-xs tabular ${
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
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px] shrink-0">
            {week.map((date, di) => (
              <div
                key={di}
                title={date ?? undefined}
                className={`w-[10px] h-[10px] rounded-sm ${date && activeDates.has(date) ? "bg-accent" : "bg-surface-raised"}`}
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

  const years = [...activeDates].map((d) => Number(d.slice(0, 4)));
  const earliestYear = years.length > 0 ? Math.min(...years) : currentYear;
  // Includes the current year (not just prior ones) — otherwise earlier
  // months in the same year (e.g. June, if it's now July) would have no view
  // at all: not "this month," and not a "previous year" either.
  const yearViews: number[] = [];
  for (let y = currentYear; y >= earliestYear; y--) yearViews.push(y);

  return (
    <div className="space-y-6">
      <MonthGrid year={currentYear} month={now.getMonth()} activeDates={activeDates} today={today} />

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
