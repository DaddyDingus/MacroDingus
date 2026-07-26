import { addDays, localDateString } from "../lib/date";

// Simple 3x10 grid of squares, oldest day top-left to today bottom-right —
// replaces the previous GitHub-contribution-style weeks/day-of-week layout.
// Binary presence only (no magnitude): a completed day gets the bright
// accent fill, an incomplete day gets the muted surface fill.
export default function HabitStrip({ activeDates, days = 30 }: { activeDates: Set<string>; days?: number }) {
  const today = localDateString();
  const dates = Array.from({ length: days }, (_, i) => addDays(today, -(days - 1 - i)));

  return (
    // Fixed-size cells rather than 1fr tracks + aspect-square: once the
    // dashboard tiles became fixed squares, the old 1fr/aspect-ratio
    // combination fought the squeezed available height and the gap visually
    // collapsed. A fixed cell size + fixed gap can't collapse regardless of
    // how tight the tile gets, and centering absorbs any leftover space.
    // justify-end (not -center): every other tile's content fills the full
    // width and lines up flush with the chevron below it — centering here
    // would leave the grid's right edge short of the chevron's tip.
    <div className="h-full flex items-center justify-end">
      <div className="grid grid-cols-10 gap-1.5">
        {dates.map((date) => (
          <div
            key={date}
            title={date}
            className={`h-2 w-2 rounded-sm ${activeDates.has(date) ? "bg-accent" : "bg-dashboardTrack"}`}
          />
        ))}
      </div>
    </div>
  );
}
