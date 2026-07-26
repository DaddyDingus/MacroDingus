import { addDays, localDateString } from "../lib/date";

// A binary presence strip, not a magnitude sparkline — each day either has an
// entry or it doesn't, so one hue (filled/unfilled) is the whole story. Fits
// BentoCard's fixed h-10 children slot.
export default function HabitStrip({ activeDates, days = 30 }: { activeDates: Set<string>; days?: number }) {
  const today = localDateString();
  const cells = Array.from({ length: days }, (_, i) => addDays(today, -(days - 1 - i)));

  return (
    <div className="flex items-stretch gap-[3px] h-full">
      {cells.map((date) => (
        <div
          key={date}
          title={date}
          className={`flex-1 rounded-sm ${activeDates.has(date) ? "bg-accent" : "bg-surface-raised"}`}
        />
      ))}
    </div>
  );
}
