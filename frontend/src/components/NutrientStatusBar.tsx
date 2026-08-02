import { Pencil } from "lucide-react";
import type { Nutrition } from "../api/types";
import type { MacroTargets } from "./MacroSummaryBar";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";

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

// The time pill, split out so it can sit inline with the X/back button on
// its own top row (grid-cols-[1fr_auto_1fr] in BrowseHeader/FoodDetailScreen)
// instead of stacked directly above NutrientStatusBar's "Remaining Today"
// label — the two rows sitting right on top of each other read as cramped.
export function LogTimePill({
  timeLabel,
  onTimeClick,
}: {
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
  return onTimeClick ? (
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
  );
}

// The "Remaining Today" macro budget bars from AddFoodSheet's browse header,
// pulled out so Food Detail can show the same persistent context — drilling
// into a food's own nutrition breakdown shouldn't mean losing sight of what's
// actually left for the day.
export default function NutrientStatusBar({
  totals,
  plateTotals,
  extra,
  targets,
}: {
  totals?: Nutrition;
  // Folded in so "N left" ticks down live as items are staged, not just once
  // they're actually logged — same reasoning as BrowseHeader's own version of
  // this math.
  plateTotals?: Nutrition;
  // FoodDetailScreen's own live-scaled nutrition for whatever quantity is
  // currently typed in its bottom input — folded in the same way plateTotals
  // is, so the budget bars preview the food being configured *before* it's
  // added/staged, updating on every keystroke instead of only after Add/Save.
  // Not part of `totals`/`plateTotals` themselves since neither the day's
  // logged totals nor the staged plate actually include this food yet.
  extra?: Nutrition;
  targets?: MacroTargets | null;
}) {
  const { unit: energyUnit } = useEnergyUnit();
  const consumedCal = (totals?.calories ?? 0) + (plateTotals?.calories ?? 0) + (extra?.calories ?? 0);
  const consumedProtein = (totals?.protein ?? 0) + (plateTotals?.protein ?? 0) + (extra?.protein ?? 0);
  const consumedFat = (totals?.fat ?? 0) + (plateTotals?.fat ?? 0) + (extra?.fat ?? 0);
  const consumedCarbs = (totals?.carbs ?? 0) + (plateTotals?.carbs ?? 0) + (extra?.carbs ?? 0);
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
  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      {/* One "Remaining today" label for the whole row instead of repeating
          "left" on every pill — same information, said once. */}
      <p className="text-[9px] tracking-widest uppercase text-white/40">Remaining Today</p>
      {/* grid grid-cols-4, not the flex+gap row this used to be — flex sized
          each column to its own label's rendered width, so protein/fat/carbs
          (short labels like "44P") ended up with visibly stubby bars next to
          calories' much longer one ("941 kcal"). Four equal columns match
          MacroSummaryBar's Food Log header instead, where every bar is the
          same length regardless of label length. Track thickness (h-1)
          matches MacroSummaryBar and DashboardTotalsArcCard's own macro row
          exactly (see MacroSummaryBar's comment — h-2.5 and h-1.5 were both
          tried and both measured objectively thicker than that reference,
          not just perceived that way). Was h-[3px] originally. */}
      <div className="grid grid-cols-4 gap-3 w-full">
        <BudgetBadge
          label={targets ? `${fmt(kcalToUnit(targets.calories - consumedCal, energyUnit))} ${energyUnitLabel(energyUnit)}` : "—"}
          pctValue={calPct}
          colorClass="bg-calories"
        />
        <BudgetBadge
          label={targets ? `${fmt(targets.proteinG - consumedProtein)}P` : "—"}
          pctValue={proteinPct}
          colorClass="bg-protein"
        />
        <BudgetBadge
          label={targets ? `${fmt(targets.fatG - consumedFat)}F` : "—"}
          pctValue={fatPct}
          colorClass="bg-fat"
        />
        <BudgetBadge
          label={targets ? `${fmt(targets.carbsG - consumedCarbs)}C` : "—"}
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
      {/* truncate (not whitespace-nowrap alone) — the parent column is now a
          fixed 1/4-grid-width, not sized to this label, so a long value
          needs somewhere to go instead of overflowing into the next badge. */}
      <span className="h-5 flex items-center text-[11px] font-medium text-white truncate tabular">{label}</span>
      {/* w-full resolves against the equal grid column width now, same as
          MacroSummaryBar's bars — every badge's track is the same length
          regardless of how many digits/characters its label has. */}
      <span className="block h-1 w-full rounded-full bg-dashboardTrack overflow-hidden">
        <span className={`block h-full rounded-full ${colorClass}`} style={{ width: `${pctValue}%` }} />
      </span>
    </span>
  );
}
