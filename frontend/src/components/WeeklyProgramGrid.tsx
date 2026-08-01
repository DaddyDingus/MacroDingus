export interface WeeklyProgramGridDay {
  dayOfWeek: number; // 0=Sunday..6=Saturday, matches JS Date.getDay()
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

// Monday-first display order regardless of the app's internal Sun=0
// storage convention — matches the familiar week-view MacroFactor's own
// grid uses, purely a display concern (program_days themselves stay
// Sun=0..Sat=6 for the JS Date.getDay() lookup in lib/programTargets.ts).
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]; // indexed by dayOfWeek (Sun=0)

// Bar height is genuinely proportional to grams, not a fixed row — a flat
// program (every day identical) looks the same as before, but a shifted
// distribution now visibly shows which days carry more, which a fixed-height
// table couldn't. Scaled against the single largest value across every
// macro on every displayed day (not each bar/macro independently), so
// height stays an honest, comparable measure both across days and across
// macros within a day — carbs reading taller than protein because there
// really are more grams of it, not because of independent per-series scaling.
const MAX_BAR_HEIGHT_PX = 96;
const MIN_BAR_HEIGHT_PX = 22;
// Approximate rendered height of the calorie pill (text-[9px] py-0.5):
// 9px font × ~1.5 line-height + 2×2px padding ≈ 17.5px. 20px gives a safe
// margin so the pill never gets clipped inside the shared container.
const PILL_HEIGHT_PX = 20;
// Gap between calorie pill and the top macro bar inside the container.
const PILL_BAR_GAP_PX = 4;

// The 7-day Mon-Sun grid used on the Strategy screen's Program card, the
// New Program wizard's results screen, and Edit Program's top preview —
// one place so all three can never visually drift apart.
export default function WeeklyProgramGrid({ days, unit }: { days: WeeklyProgramGridDay[]; unit: string }) {
  const byDow = new Map(days.map((d) => [d.dayOfWeek, d]));
  const maxGrams = Math.max(1, ...days.flatMap((d) => [d.proteinG, d.fatG, d.carbsG]));
  const barHeightPx = (grams: number) => Math.max(MIN_BAR_HEIGHT_PX, Math.round((grams / maxGrams) * MAX_BAR_HEIGHT_PX));

  // Container height = tallest bar stack + pill + gap, so all columns share
  // the same baseline. The calorie pill is placed at the top of this
  // container and the macro bars at the bottom — for lower-calorie days the
  // pill sits closer to the bars (pill tracks with bars, not the top of the
  // tallest column).
  const maxStackHeight = Math.max(
    ...DISPLAY_ORDER.map((dow) => {
      const d = byDow.get(dow);
      if (!d) return 0;
      return barHeightPx(d.proteinG) + barHeightPx(d.fatG) + barHeightPx(d.carbsG) + 6; // 2 × 3px gap
    })
  );
  const containerHeight = maxStackHeight + PILL_HEIGHT_PX + PILL_BAR_GAP_PX;

  return (
    <div>
      <div className="flex gap-2 justify-center">
        {DISPLAY_ORDER.map((dow) => {
          const d = byDow.get(dow);
          if (!d) return null;
          return (
            <div key={dow} className="flex flex-col items-center gap-1 min-w-0 flex-1 max-w-[38px]">
              {/* Single container: calorie pill pinned top, macro bars pinned
                  bottom — a spacer div (flex-1) between them lets each day's
                  pill track directly above its own bar stack instead of
                  floating at the top of the tallest column. */}
              <div className="w-full flex flex-col" style={{ height: containerHeight }}>
                <span className="w-full text-[9px] py-0.5 rounded-full bg-calories/90 text-white tabular text-center overflow-hidden shrink-0">
                  {Math.round(d.calories)}
                </span>
                <div className="flex-1" />
                <div className="w-full flex flex-col gap-[3px]">
                  <div
                    className="w-full rounded-md bg-protein/90 text-white text-[9px] font-medium tabular flex items-center justify-center overflow-hidden"
                    style={{ height: barHeightPx(d.proteinG) }}
                  >
                    {Math.round(d.proteinG)}P
                  </div>
                  <div
                    className="w-full rounded-md bg-fat/90 text-black text-[9px] font-medium tabular flex items-center justify-center overflow-hidden"
                    style={{ height: barHeightPx(d.fatG) }}
                  >
                    {Math.round(d.fatG)}F
                  </div>
                  <div
                    className="w-full rounded-md bg-carbs/90 text-white text-[9px] font-medium tabular flex items-center justify-center overflow-hidden"
                    style={{ height: barHeightPx(d.carbsG) }}
                  >
                    {Math.round(d.carbsG)}C
                  </div>
                </div>
              </div>
              <span className="text-[9px] text-muted">{DAY_LETTERS[dow]}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted mt-1.5">{unit}, per day</p>
    </div>
  );
}
