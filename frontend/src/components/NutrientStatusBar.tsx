import { Pencil } from "lucide-react";
import type { Nutrition } from "../api/types";
import type { MacroTargets } from "./MacroSummaryBar";
import { useEnergyUnit, kcalToUnit } from "../lib/energyUnit";

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

function pct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, (value / target) * 100));
}

// "8 AM" — hour-only fallback for callers that don't pass a real timeLabel
// (nothing in this app currently renders NutrientStatusBar without one, but
// keeping a "now" default means a future caller that skips the prop still
// gets a sensible glance at "when this will be logged" rather than blank).
function formatHourLabel(d = new Date()): string {
  const hour = d.getHours() % 12 || 12;
  const suffix = d.getHours() >= 12 ? "PM" : "AM";
  return `${hour} ${suffix}`;
}

// The time pill + calories/protein "N left" badges from AddFoodSheet's
// browse header, pulled out so Food Detail can show the same persistent
// context — drilling into a food's nutrition breakdown shouldn't mean losing
// sight of what's actually left for the day. AddFoodSheet's own BrowseHeader
// wraps this with its X button, staged-avatar stack, and expand/collapse
// chevron, none of which apply once you're on a full sub-screen like Food
// Detail; those extras stay local to BrowseHeader rather than becoming props
// here that would only ever be used by one caller.
export default function NutrientStatusBar({
  totals,
  plateTotals,
  targets,
  timeLabel,
  onTimeClick,
}: {
  totals?: Nutrition;
  // Folded in so "N left" ticks down live as items are staged, not just once
  // they're actually logged — same reasoning as BrowseHeader's own version of
  // this math.
  plateTotals?: Nutrition;
  targets?: MacroTargets | null;
  // Pre-formatted "9:20 PM"-style label for what this plate will actually log
  // under — passed by AddFoodSheet from its own loggedAtOverride state, not
  // computed here, so this component stays a dumb display + tap target.
  timeLabel?: string;
  // When provided, the pill becomes a real button that opens a time picker —
  // AddFoodSheet wires this on both the browse and detail steps (so the
  // control stays available regardless of which one is showing); passing
  // nothing keeps the pill inert, e.g. while editing an existing entry's
  // quantity, where "log time" doesn't apply.
  onTimeClick?: () => void;
}) {
  const { unit: energyUnit } = useEnergyUnit();
  const consumedCal = (totals?.calories ?? 0) + (plateTotals?.calories ?? 0);
  const consumedProtein = (totals?.protein ?? 0) + (plateTotals?.protein ?? 0);
  const consumedFat = (totals?.fat ?? 0) + (plateTotals?.fat ?? 0);
  const consumedCarbs = (totals?.carbs ?? 0) + (plateTotals?.carbs ?? 0);
  const calPct = targets && targets.calories > 0 ? pct(consumedCal, targets.calories) : 0;
  const proteinPct = targets && targets.proteinG > 0 ? pct(consumedProtein, targets.proteinG) : 0;
  const fatPct = targets && targets.fatG > 0 ? pct(consumedFat, targets.fatG) : 0;
  const carbsPct = targets && targets.carbsG > 0 ? pct(consumedCarbs, targets.carbsG) : 0;

  // The badges below are always mounted, even before `targets` has loaded (a
  // query that's typically still pending on the very first render of a
  // freshly-opened AddFoodSheet) — this row used to be conditionally rendered
  // on `targets` alone, so the header was a single-line time pill until the
  // check-in query resolved, then grew a few pixels taller once it did. That
  // resize landed a moment after the sheet opened, which happened to line up
  // with roughly when the on-screen keyboard's own slide-in animation was
  // also settling (both are just async operations of similar duration), so
  // the resulting jolt read as keyboard-caused even though it was really this
  // header quietly changing height on unrelated data arriving. Keeping the
  // row's height constant from the first paint means there's nothing left to
  // correct later.
  //
  // Time sits on its own centered row above the four macro badges rather
  // than inline with them — with all four macros (not just calories/protein)
  // now shown, inline would either crowd BrowseHeader's row (which also
  // carries the close button, staged-avatar stack, and expand chevron) or
  // force the badges to shrink. Stacking also lets the time genuinely center
  // against the badge row beneath it instead of just the leftover space
  // between those flanking controls.
  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      {onTimeClick ? (
        <button
          type="button"
          onClick={onTimeClick}
          aria-label="Change log time"
          className="shrink-0 h-5 flex items-center gap-1 rounded-full bg-dashboardChip pl-2.5 pr-2 text-[11px] font-medium text-white tabular active:bg-white/20"
        >
          {timeLabel ?? formatHourLabel()}
          <Pencil className="w-2.5 h-2.5 text-white/50" strokeWidth={2.5} />
        </button>
      ) : (
        <span className="shrink-0 h-5 flex items-center rounded-full bg-dashboardChip px-2.5 text-[11px] font-medium text-white tabular">
          {timeLabel ?? formatHourLabel()}
        </span>
      )}
      <div className="flex items-start justify-center gap-3 min-w-0">
        <BudgetBadge
          label={targets ? `${fmt(kcalToUnit(targets.calories - consumedCal, energyUnit))} left` : "—"}
          pctValue={calPct}
          colorClass="bg-calories"
        />
        <BudgetBadge
          label={targets ? `${fmt(targets.proteinG - consumedProtein)}P left` : "—"}
          pctValue={proteinPct}
          colorClass="bg-protein"
        />
        <BudgetBadge
          label={targets ? `${fmt(targets.fatG - consumedFat)}F left` : "—"}
          pctValue={fatPct}
          colorClass="bg-fat"
        />
        <BudgetBadge
          label={targets ? `${fmt(targets.carbsG - consumedCarbs)}C left` : "—"}
          pctValue={carbsPct}
          colorClass="bg-carbs"
        />
      </div>
    </div>
  );
}

// colorClass ties each badge's fill to that macro's established categorical
// color (bg-calories/bg-protein — same all-pairs-validated palette used
// everywhere else a macro gets a color, e.g. FoodDetailScreen's Impact rings)
// rather than the generic bg-white/70 this used to hardcode.
function BudgetBadge({ label, pctValue, colorClass }: { label: string; pctValue: number; colorClass: string }) {
  return (
    <span className="flex flex-col items-center gap-1 min-w-0">
      <span className="h-5 flex items-center text-[11px] font-medium text-white whitespace-nowrap tabular">{label}</span>
      <span className="block h-[3px] w-10 rounded-full bg-dashboardTrack overflow-hidden">
        <span className={`block h-full rounded-full ${colorClass}`} style={{ width: `${pctValue}%` }} />
      </span>
    </span>
  );
}
