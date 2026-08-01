import { useState } from "react";
import { Plus, Heart } from "lucide-react";
import ConfirmDeleteSheet from "./ConfirmDeleteSheet";
import type { Food, Nutrition } from "../api/types";
import type { MacroTargets } from "./MacroSummaryBar";
import { scaleNutrition } from "../lib/nutrition";
import { useBackDismiss } from "../lib/useBackDismiss";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import FoodIconAvatar from "./FoodIconAvatar";
import NutrientStatusBar from "./NutrientStatusBar";

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function pct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, (value / target) * 100));
}

// Same four hex values as AddFoodSheet.tsx's NUTRITION_METRICS / tailwind.config.js
// (calories=blue, protein=orange, fat=yellow, carbs=green) — the one
// all-pairs-validated categorical set this app uses everywhere macros get a
// color, reused via the matching `text-*` Tailwind utilities rather than
// hardcoding hex again here.
const RING_METRICS: { key: "calories" | "protein" | "fat" | "carbs"; label: string; colorClass: string }[] = [
  { key: "calories", label: "Calories", colorClass: "text-calories" },
  { key: "protein", label: "Protein", colorClass: "text-protein" },
  { key: "fat", label: "Fat", colorClass: "text-fat" },
  { key: "carbs", label: "Carbs", colorClass: "text-carbs" },
];

function targetFor(targets: MacroTargets | null | undefined, key: "calories" | "protein" | "fat" | "carbs"): number {
  if (!targets) return 0;
  if (key === "calories") return targets.calories;
  if (key === "protein") return targets.proteinG;
  if (key === "fat") return targets.fatG;
  return targets.carbsG;
}

type Unit = "g" | "oz" | "serving" | "lb";
const GRAMS_PER_OZ = 28.3495;
const GRAMS_PER_LB = 453.592;

// Same FDA %DV reference amounts as the MicroMeta dailyValue fields below,
// just for the four nutrients that get their own dedicated Nutrition field
// instead of living in the microsJson bag. Used only to size each row's bar
// fill — never rendered as a number.
const DAILY_VALUE_REF = { protein: 50, fiber: 28, sugar: 50, saturatedFat: 20, sodiumMg: 2300 };

interface MicroMeta {
  label: string;
  unit: string;
  toDisplay: (grams: number) => number;
  // FDA Nutrition-Facts-label %DV reference amount (2,000-kcal diet) — not a
  // personalized target the way calories/protein/fat/carbs are, but used
  // purely to size each row's bar fill, never displayed as a number (see
  // BreakdownRow: the bar is a visual color-coded indicator, the text next
  // to it is always just the plain amount).
  dailyValue?: number;
}
const MG_TO_DISPLAY = (g: number) => g * 1_000;
const MCG_TO_DISPLAY = (g: number) => g * 1_000_000;

// Vitamins/minerals this app actually has data for — sourced from
// OpenFoodFacts via backend/src/engine/openfoodfacts.ts's MICRO_KEYS list and
// stored in `foods.microsJson` (per-100g, in grams — OFF's API convention
// regardless of the unit shown on the product's own label) only when OFF
// itself reported that field for the product, or entered by hand in
// CreateFoodForm's Vitamins/Minerals sections (same keys, same grams
// convention, converted from mg/mcg at entry time). Only keys actually
// present in a given food's microsJson get rendered (see parseMicros below)
// — no data for a field means "unknown," not "zero." Split into two Records
// (rather than one with a category tag) so the two breakdown sections below
// can each just object-filter against their own list directly.
const VITAMIN_META: Record<string, MicroMeta> = {
  "vitamin-a_100g": { label: "Vitamin A", unit: "mcg", toDisplay: MCG_TO_DISPLAY, dailyValue: 900 },
  "vitamin-c_100g": { label: "Vitamin C", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 90 },
  "vitamin-d_100g": { label: "Vitamin D", unit: "mcg", toDisplay: MCG_TO_DISPLAY, dailyValue: 20 },
  "vitamin-e_100g": { label: "Vitamin E", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 15 },
  "vitamin-k_100g": { label: "Vitamin K", unit: "mcg", toDisplay: MCG_TO_DISPLAY, dailyValue: 120 },
  "vitamin-b1_100g": { label: "B1 (Thiamin)", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 1.2 },
  "vitamin-b2_100g": { label: "B2 (Riboflavin)", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 1.3 },
  "vitamin-pp_100g": { label: "B3 (Niacin)", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 16 },
  "vitamin-b6_100g": { label: "B6", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 1.7 },
  "vitamin-b9_100g": { label: "B9 (Folate)", unit: "mcg", toDisplay: MCG_TO_DISPLAY, dailyValue: 400 },
  "vitamin-b12_100g": { label: "B12", unit: "mcg", toDisplay: MCG_TO_DISPLAY, dailyValue: 2.4 },
};
const MINERAL_META: Record<string, MicroMeta> = {
  "calcium_100g": { label: "Calcium", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 1300 },
  "iron_100g": { label: "Iron", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 18 },
  "magnesium_100g": { label: "Magnesium", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 420 },
  "potassium_100g": { label: "Potassium", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 4700 },
  "zinc_100g": { label: "Zinc", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 11 },
  "phosphorus_100g": { label: "Phosphorus", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 1250 },
  "copper_100g": { label: "Copper", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 0.9 },
  "manganese_100g": { label: "Manganese", unit: "mg", toDisplay: MG_TO_DISPLAY, dailyValue: 2.3 },
  "selenium_100g": { label: "Selenium", unit: "mcg", toDisplay: MCG_TO_DISPLAY, dailyValue: 55 },
  "iodine_100g": { label: "Iodine", unit: "mcg", toDisplay: MCG_TO_DISPLAY, dailyValue: 150 },
};
// Cholesterol lives in the same microsJson blob but isn't a vitamin or
// mineral — kept separate and shown under "Other" alongside Sodium, same
// grouping CreateFoodForm uses. No dailyValue — cholesterol's %DV was
// removed from the FDA label entirely in the 2016 revision, so there's no
// reference to size a bar against; this row just has no bar, same as Net
// Carbs/Other Fat/the other fat subtypes below.
const CHOLESTEROL_META: MicroMeta = { label: "Cholesterol", unit: "mg", toDisplay: MG_TO_DISPLAY };

// food.microsJson is `{ "vitamin-c_100g": 0.06, ... }` (grams per 100g) or
// null — only ever populated for OpenFoodFacts-sourced foods, and only for
// whichever fields that specific product actually reported, so this can
// (and often will) return an empty/partial list, including for every custom
// food and recipe (materialized foods never carry OFF micros at all).
function parseMicros(microsJson: string | null): Record<string, number> {
  if (!microsJson) return {};
  try {
    const parsed = JSON.parse(microsJson);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

const RING_R = 26;
const RING_CIRC = 2 * Math.PI * RING_R;

// A small full-circle meter (distinct from DashboardTotalsArcCard's big
// horseshoe gauge — that one's a single hero stat, these are four compact
// ones side by side) — plain SVG circle, rotated -90° so progress starts at
// 12 o'clock like the horseshoe gauge does, rather than the default 3
// o'clock a bare <circle> stroke-dasharray starts from. Shows only the
// percentage inside the ring and the metric name below it — no absolute
// gram/kcal value, to keep this section a quick "how much of my remaining
// budget" glance rather than a second copy of the summary row's numbers.
function Ring({ pctValue, colorClass, label }: { pctValue: number; colorClass: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-16 h-16">
        <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
          <circle cx="32" cy="32" r={RING_R} strokeWidth={3} className="fill-none stroke-dashboardTrack" />
          <circle
            cx="32"
            cy="32"
            r={RING_R}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={RING_CIRC}
            strokeDashoffset={RING_CIRC * (1 - pctValue / 100)}
            className={`fill-none ${colorClass} transition-[stroke-dashoffset] duration-500 ease-out`}
            stroke="currentColor"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="tabular text-xs font-semibold text-white">{fmt(pctValue)}%</span>
        </div>
      </div>
      <span className="text-[10px] tracking-widest uppercase text-muted">{label}</span>
    </div>
  );
}

// One row of a breakdown section — a plain-text amount (never a percentage;
// that was tried and explicitly reverted — this app has no personal target
// for any of these nutrients, only calories/protein/fat/carbs) with a
// color-coded bar underneath for a quick at-a-glance sense of magnitude.
// The bar's fill still comes from the FDA %DV reference (dailyValueRef) —
// there's nothing else to size it against — but that figure is only ever
// used as a width, never printed as a number. dailyValueRef omitted (Net
// Carbs, Other Fat, the non-saturated fat subtypes, Cholesterol) means
// there's no standard reference for it, so the row shows just the amount
// with no bar rather than a fabricated one. barColorClass ties each
// section's bars to that macro's established categorical color
// (bg-protein/bg-carbs/bg-fat) rather than a generic neutral bar — vitamins,
// minerals, and sodium aren't one of those four established categories, so
// they keep the neutral bar.
function BreakdownRow({
  label,
  amount,
  unit = "g",
  dailyValueRef,
  barColorClass = "bg-white/60",
}: {
  label: string;
  amount: number;
  unit?: string;
  dailyValueRef?: number;
  barColorClass?: string;
}) {
  const percent = dailyValueRef ? pct(amount, dailyValueRef) : null;
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-white">{label}</span>
        <span className="tabular text-sm text-muted shrink-0">
          {fmt(amount, unit === "g" ? 1 : 2)} {unit}
        </span>
      </div>
      {percent !== null && (
        <span className="block h-[3px] w-full rounded-full bg-dashboardTrack overflow-hidden mt-1.5">
          <span className={`block h-full rounded-full ${barColorClass}`} style={{ width: `${percent}%` }} />
        </span>
      )}
    </div>
  );
}


// Short vibration on every key tap (including Log Foods/Add) — a no-op
// wherever the Vibration API isn't supported (notably iOS Safari), so this
// is a bonus on top of the visual feedback, never depended on.
function triggerHaptic(durationMs = 10) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(durationMs);
  }
}

// Generic two-key footer — left key muted/secondary, right key the
// highlighted primary action, same visual hierarchy the numpad grid this
// replaced used to have between its own two bottom-right action keys.
// Shared by the normal browse-and-stage footer (Log Foods / Add) and the
// editing footer (Delete / Save) rather than hardcoding either pair's
// labels/handlers here.
function ActionButtons({
  leftLabel,
  onLeft,
  leftDisabled,
  rightLabel,
  onRight,
  rightDisabled,
}: {
  leftLabel: string;
  onLeft: () => void;
  leftDisabled: boolean;
  rightLabel: string;
  onRight: () => void;
  rightDisabled: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        onClick={() => {
          triggerHaptic(15);
          onLeft();
        }}
        disabled={leftDisabled}
        className="rounded-lg bg-dashboardChip text-muted text-sm font-semibold py-3.5 disabled:opacity-40"
      >
        {leftLabel}
      </button>
      {/* Explicit background/text swap rather than an opacity dim on a
          permanently-white button — muted (same gray as the left key) at
          0/empty, solid white with black text once there's a valid amount,
          so the state change reads clearly rather than as a faded version
          of the same look. */}
      <button
        onClick={() => {
          triggerHaptic(15);
          onRight();
        }}
        disabled={rightDisabled}
        className={`rounded-lg text-sm font-bold py-3.5 ${rightDisabled ? "bg-dashboardChip text-muted" : "bg-white text-black"}`}
      >
        {rightLabel}
      </button>
    </div>
  );
}

export default function FoodDetailScreen({
  food,
  totals,
  plateTotals,
  targets,
  stagedCount = 0,
  initialQuantityGrams,
  backLabel = "Back to search results",
  onBack,
  onAdd,
  onLogFoods,
  onSaveAsCustom,
  isFavorite = false,
  onToggleFavorite,
  editing,
  onDeleteFood,
  timeLabel,
  onTimeClick,
}: {
  food: Food;
  totals?: Nutrition;
  // Already-staged plate items elsewhere in this AddFoodSheet session — folded
  // into the persistent header's "N left" badges the same way BrowseHeader
  // folds them in, so the number doesn't lag a step behind until this food is
  // actually staged/logged.
  plateTotals?: Nutrition;
  targets?: MacroTargets | null;
  // How many items are already staged elsewhere in this AddFoodSheet session
  // — only used to label the numpad's "Log Foods" key (e.g. "Log Foods (3)"
  // once this food's own quantity would make it 3), not read for anything
  // else here.
  stagedCount?: number;
  // Seeds the quantity input from an already-logged entry's own amount
  // instead of the browse-and-stage flow's flat 100 — set alongside
  // `editing` below when opened to edit rather than add.
  initialQuantityGrams?: number;
  backLabel?: string;
  onBack: () => void;
  onAdd: (food: Food, quantityGrams: number) => void;
  onLogFoods: (food: Food, quantityGrams: number) => void;
  // Opens the custom food creator prefilled with this food's own data (see
  // CreateFoodForm's prefillFood) — lets a tweaked copy get saved as a
  // separate new food rather than editing this one.
  onSaveAsCustom: (food: Food) => void;
  isFavorite?: boolean;
  onToggleFavorite: (food: Food) => void;
  // Set when this screen is editing an already-logged entry (via the Food
  // Log's Edit shortcut) rather than staging a new one — swaps the footer's
  // Log Foods/Add pair for Delete/Save. onAdd/onLogFoods/stagedCount are
  // simply unused in this mode rather than made conditionally optional,
  // since AddFoodSheet always has a real plate (empty or not) to pass them
  // from regardless of which mode this screen is in.
  editing?: {
    onSave: (quantityGrams: number) => void;
    onDelete: () => void;
  };
  onDeleteFood?: () => void;
  // Same "9:20 PM"-style label + tap handler BrowseHeader wires on the
  // browse step — passed through here too so the persistent status bar stays
  // interactive regardless of which of the two steps happens to be showing.
  // Left undefined while editing an already-logged entry, where there's no
  // "log time" being staged.
  timeLabel?: string;
  onTimeClick?: () => void;
}) {
  // Nested on top of AddFoodSheet's own outer back-dismiss trap. Quantity
  // entry here is a custom on-screen numpad, not a real text input, so
  // there's no actual system keyboard for a back gesture to close first —
  // without a trap of its own, that first gesture fell straight through to
  // the outer one and exited the whole logging sheet in one press. This
  // makes gesture-back consume one press to return to browse (same as the
  // `‹` header button), then a second press reaches the outer trap.
  useBackDismiss(true, onBack);

  const hasServing = food.servingSizeGrams != null;
  const [unit, setUnit] = useState<Unit>("g");
  const [quantityInput, setQuantityInput] = useState(String(initialQuantityGrams ?? 100));
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const units: Unit[] = hasServing ? ["g", "oz", "lb", "serving"] : ["g", "oz", "lb"];
  const unitLabel = (u: Unit) => (u === "serving" ? food.servingName ?? "serving" : u);

  const gramsPerUnit = unit === "oz" ? GRAMS_PER_OZ : unit === "lb" ? GRAMS_PER_LB : unit === "serving" ? food.servingSizeGrams ?? 100 : 1;
  const quantity = Number(quantityInput) || 0;
  const quantityGrams = Math.max(0, quantity * gramsPerUnit);

  const n = scaleNutrition(food, quantityGrams);
  const { unit: energyUnit } = useEnergyUnit();
  const macroCalories = n.protein * 4 + n.fat * 9 + n.carbs * 4;
  const caloricRatio = (cal: number) => (macroCalories > 0 ? Math.round((cal / macroCalories) * 100) : 0);

  // Only the vitamin/mineral keys this specific food actually has data for —
  // see parseMicros/VITAMIN_META/MINERAL_META above for why missing keys are
  // skipped rather than shown as zero.
  const scaleFactor = quantityGrams / 100;
  const parsedMicros = parseMicros(food.microsJson);
  function microList(meta: Record<string, MicroMeta>) {
    return Object.entries(parsedMicros)
      .filter(([key]) => key in meta)
      .map(([key, rawPer100g]) => ({ key, ...meta[key], amount: meta[key].toDisplay(rawPer100g * scaleFactor) }));
  }
  const vitamins = microList(VITAMIN_META);
  const minerals = microList(MINERAL_META);
  const cholesterolRaw = parsedMicros["cholesterol_100g"];
  const cholesterolAmount = cholesterolRaw != null ? CHOLESTEROL_META.toDisplay(cholesterolRaw * scaleFactor) : null;

  // Fat subtypes are explicit Food columns (not microsJson) — see
  // schema.ts. null means unreported (custom food never filled in, or OFF
  // didn't have it for this product), same "omit, don't show zero"
  // treatment as the microsJson-backed fields above.
  function scaleOptional(per100g: number | null | undefined): number | null {
    return per100g != null ? per100g * scaleFactor : null;
  }
  const monounsaturated = scaleOptional(food.monounsaturatedFatPer100g);
  const polyunsaturated = scaleOptional(food.polyunsaturatedFatPer100g);
  const omega3 = scaleOptional(food.omega3Per100g);
  const omega6 = scaleOptional(food.omega6Per100g);
  const transFat = scaleOptional(food.transFatPer100g);

  const ringData = RING_METRICS.map((m) => {
    const consumed = totals?.[m.key] ?? 0;
    const target = targetFor(targets, m.key);
    const remaining = Math.max(0, target - consumed);
    return { ...m, pctValue: targets ? pct(n[m.key], remaining) : 0 };
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Persistent header — pulled out of the scrollable region below (it
          used to live inside it and scroll away with the rest of the
          breakdown, along with the back button). NutrientStatusBar is the
          same time/calories-left/protein-left/fat-left/carbs-left row the
          search sheet shows (see AddFoodSheet's BrowseHeader) — drilling
          into a food's own nutrition breakdown shouldn't mean losing sight
          of what's actually left for the day. The back button gets its own
          top-left row above the status bar, mirroring BrowseHeader's
          top-corners-then-bars shape (X top-left there, avatar-stack/chevron
          top-right) so the bars land at the same vertical offset in both
          places despite the two screens having different top-row controls.
          pt accounts for the status bar/notch the same way BrowseHeader's
          does, since this sits at the very top of the same full-screen
          modal once "detail" is the active step. */}
      <div className="shrink-0" style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}>
        <div className="px-4 pb-2">
          {/* h-5 flex items-center matches BrowseHeader's X button box exactly
              (w-5 h-5 icon) — this glyph alone at text-lg/leading-none rendered
              a couple px shorter, which was enough to shift NutrientStatusBar
              a hair between the two screens despite both sitting the same
              gap below this row. */}
          <button
            onClick={onBack}
            aria-label={backLabel}
            className="shrink-0 h-5 flex items-center text-muted text-lg leading-none px-1 -mx-1"
          >
            ‹
          </button>
        </div>
        <div className="px-4 pb-3">
          <NutrientStatusBar
            totals={totals}
            plateTotals={plateTotals}
            targets={targets}
            timeLabel={timeLabel}
            onTimeClick={onTimeClick}
          />
        </div>
        <div className="px-4 pb-2 flex items-center gap-3">
          <FoodIconAvatar name={food.name} icon={food.icon} />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-white truncate">{food.name}</span>
            {food.brand && <span className="block text-[11px] text-muted truncate">{food.brand}</span>}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
        {/* Summary row: strict per-column stack of badge (if any) -> large
            value -> muted label, sized so calories reads as primary without
            dwarfing protein/fat/carbs (2xl vs xl, not the previous 3xl vs
            lg). items-end bottom-aligns the four columns so calories'
            missing badge (there's nothing to take a caloric-ratio "% of
            itself") doesn't throw off the row. */}
        <div className="px-4 pt-2 pb-4 grid grid-cols-4 gap-2 items-end">
          <div className="col-span-1">
            <p className="tabular text-2xl font-bold text-calories leading-none">{fmt(kcalToUnit(n.calories, energyUnit))}</p>
            <p className="text-[10px] text-muted mt-1.5">{energyUnitLabel(energyUnit)}</p>
          </div>
          {(["protein", "fat", "carbs"] as const).map((key) => {
            const cal = key === "protein" ? n.protein * 4 : key === "fat" ? n.fat * 9 : n.carbs * 4;
            // Full literal class strings per branch (not a template-built
            // `bg-${key}/15`) — Tailwind's JIT only picks up classes it can
            // find as complete strings in the source.
            const badgeClass =
              key === "protein" ? "bg-protein/15 text-protein" : key === "fat" ? "bg-fat/15 text-fat" : "bg-carbs/15 text-carbs";
            return (
              <div key={key} className="text-center">
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${badgeClass}`}>
                  {caloricRatio(cal)}%
                </span>
                <p className="tabular text-xl font-semibold text-white leading-none mt-1.5">{fmt(n[key], 1)}</p>
                <p className="text-[10px] text-muted mt-0.5 capitalize">{key}</p>
              </div>
            );
          })}
        </div>

        {/* "To custom" duplicates this food into the create-food form (see
            CreateFoodForm's prefillFood) so a tweak-and-save produces a
            separate new food rather than editing this one; "Favourite" just
            toggles membership in the per-user favorites list surfaced back on
            the search sheet. Both are equal-width pill buttons, not full-width
            stacked — neither needs to dominate the row the way Add/Log Foods
            does in the footer. */}
        <div className="px-4 pb-2 flex gap-2">
          <button
            onClick={() => onSaveAsCustom(food)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-dashboardChip text-white text-xs font-medium py-2 active:bg-white/20"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            To custom
          </button>
          <button
            onClick={() => onToggleFavorite(food)}
            aria-pressed={isFavorite}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-full text-xs font-medium py-2 ${
              isFavorite ? "bg-white text-black" : "bg-dashboardChip text-white active:bg-white/20"
            }`}
          >
            <Heart className="w-3.5 h-3.5" strokeWidth={2.5} fill={isFavorite ? "currentColor" : "none"} />
            Favourite
          </button>
        </div>

        {/* Impact on Targets */}
        <div className="px-4 pt-2 pb-4 border-t border-dashboardDivider">
          <p className="text-[13px] font-semibold text-white/80 pt-3 pb-3">Impact on Targets</p>
          {targets ? (
            <div className="grid grid-cols-4 gap-2">
              {ringData.map((r) => (
                <Ring key={r.key} pctValue={r.pctValue} colorClass={r.colorClass} label={r.label} />
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted">Set up daily targets on Strategy to see impact here.</p>
          )}
        </div>

        {/* Detailed nutrient breakdown — plain label + amount rows, grouped
            into categories. Section headers are Title Case (as authored,
            not forced uppercase) with a heavier weight for readability. */}
        <div className="px-4 pt-2 border-t border-dashboardDivider">
          <p className="text-[13px] font-semibold text-white/80 pt-3">Protein Breakdown</p>
          <div className="divide-y divide-dashboardDivider/60">
            <BreakdownRow label="Protein" amount={n.protein} dailyValueRef={DAILY_VALUE_REF.protein} barColorClass="bg-protein" />
          </div>
        </div>

        <div className="px-4 pt-4 border-t border-dashboardDivider mt-4">
          <p className="text-[13px] font-semibold text-white/80 pt-3">Carb Breakdown</p>
          <div className="divide-y divide-dashboardDivider/60">
            <BreakdownRow label="Fiber" amount={n.fiber} dailyValueRef={DAILY_VALUE_REF.fiber} barColorClass="bg-carbs" />
            <BreakdownRow label="Sugars" amount={n.sugar} dailyValueRef={DAILY_VALUE_REF.sugar} barColorClass="bg-carbs" />
            <BreakdownRow label="Net Carbs" amount={Math.max(0, n.carbs - n.fiber)} />
          </div>
        </div>

        <div className="px-4 pt-4 border-t border-dashboardDivider mt-4">
          <p className="text-[13px] font-semibold text-white/80 pt-3">Fat Breakdown</p>
          <div className="divide-y divide-dashboardDivider/60">
            <BreakdownRow label="Saturated Fat" amount={n.saturatedFat} dailyValueRef={DAILY_VALUE_REF.saturatedFat} barColorClass="bg-fat" />
            {monounsaturated !== null && <BreakdownRow label="Monounsaturated" amount={monounsaturated} />}
            {polyunsaturated !== null && <BreakdownRow label="Polyunsaturated" amount={polyunsaturated} />}
            {omega3 !== null && <BreakdownRow label="Omega-3" amount={omega3} />}
            {omega6 !== null && <BreakdownRow label="Omega-6" amount={omega6} />}
            {transFat !== null && <BreakdownRow label="Trans Fat" amount={transFat} />}
            <BreakdownRow label="Other Fat" amount={Math.max(0, n.fat - n.saturatedFat)} />
          </div>
        </div>

        {/* Vitamins and Minerals get their own categorized sections rather
            than one lumped "Vitamins & Minerals" list — each is only
            rendered at all when this food actually has at least one value in
            that category (see the vitamins/minerals computation above); an
            OpenFoodFacts product with none reported, or any custom
            food/recipe with nothing entered, just skips the section rather
            than showing an empty heading. */}
        {vitamins.length > 0 && (
          <div className="px-4 pt-4 border-t border-dashboardDivider mt-4">
            <p className="text-[13px] font-semibold text-white/80 pt-3">Vitamins</p>
            <div className="divide-y divide-dashboardDivider/60">
              {vitamins.map((m) => (
                <BreakdownRow key={m.key} label={m.label} amount={m.amount} unit={m.unit} dailyValueRef={m.dailyValue} />
              ))}
            </div>
          </div>
        )}

        {minerals.length > 0 && (
          <div className="px-4 pt-4 border-t border-dashboardDivider mt-4">
            <p className="text-[13px] font-semibold text-white/80 pt-3">Minerals</p>
            <div className="divide-y divide-dashboardDivider/60">
              {minerals.map((m) => (
                <BreakdownRow key={m.key} label={m.label} amount={m.amount} unit={m.unit} dailyValueRef={m.dailyValue} />
              ))}
            </div>
          </div>
        )}

        <div className="px-4 pt-4 border-t border-dashboardDivider mt-4">
          <p className="text-[13px] font-semibold text-white/80 pt-3">Other</p>
          <div className="divide-y divide-dashboardDivider/60">
            <BreakdownRow label="Sodium" amount={n.sodiumMg} unit="mg" dailyValueRef={DAILY_VALUE_REF.sodiumMg} />
            {cholesterolAmount !== null && <BreakdownRow label="Cholesterol" amount={cholesterolAmount} unit="mg" />}
          </div>
        </div>

        {(food.source === "custom" || food.source === "ai_estimate") && onDeleteFood && (
          <div className="px-4 pt-6 pb-2">
            <button
              onClick={() => setConfirmingDelete(true)}
              className="w-full py-2.5 text-sm text-muted"
            >
              Delete food
            </button>
          </div>
        )}
      </div>

      {/* Docked footer, top to bottom: a real quantity input (pops the
          phone's own system keyboard — a custom on-screen numpad used to
          live here, but that meant there was never a real keyboard for a
          back gesture to dismiss, so it always exited straight to browse in
          one press instead of closing the keyboard first the way it does
          everywhere else with a real input), a horizontally scrollable unit
          carousel, then Log Foods/Add. */}
      <div className="shrink-0 border-t border-white/10 bg-dashboardBg px-4 pt-3 pb-3">
        <div className="rounded-xl bg-dashboardCard border border-white/30 px-4 py-3 mb-2.5 flex items-center justify-between gap-1.5 focus-within:border-accent">
          <input
            type="number"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            value={quantityInput}
            onChange={(e) => setQuantityInput(e.target.value)}
            onKeyDown={(e) => {
              // Two competing actions live in this footer (Log Foods vs.
              // Add, or Delete vs. Save while editing), so this isn't a
              // plain <form> wrap — Enter maps to whichever one is the
              // visually "primary" (white/bold) button in ActionButtons:
              // onAdd/onSave, never the muted secondary one, and only when
              // that button isn't itself disabled.
              if (e.key !== "Enter" || quantityGrams <= 0) return;
              e.preventDefault();
              if (editing) editing.onSave(quantityGrams);
              else onAdd(food, quantityGrams);
            }}
            aria-label="Quantity"
            className="min-w-0 flex-1 bg-transparent tabular text-2xl font-semibold text-white focus:outline-none"
          />
          <span className="text-sm text-muted shrink-0">{unitLabel(unit)}</span>
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2.5">
          {units.map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium whitespace-nowrap ${
                unit === u ? "bg-white text-black" : "bg-dashboardChip text-muted"
              }`}
            >
              {unitLabel(u)}
            </button>
          ))}
        </div>

        {editing ? (
          <ActionButtons
            leftLabel="Delete"
            onLeft={editing.onDelete}
            leftDisabled={false}
            rightLabel="Save"
            onRight={() => editing.onSave(quantityGrams)}
            rightDisabled={quantityGrams <= 0}
          />
        ) : (
          <ActionButtons
            leftLabel={
              stagedCount + (quantityGrams > 0 ? 1 : 0) > 0
                ? `Log Foods (${stagedCount + (quantityGrams > 0 ? 1 : 0)})`
                : "Log Foods"
            }
            onLeft={() => onLogFoods(food, quantityGrams)}
            leftDisabled={quantityGrams <= 0 && stagedCount === 0}
            rightLabel="Add"
            onRight={() => onAdd(food, quantityGrams)}
            rightDisabled={quantityGrams <= 0}
          />
        )}
      </div>
      {confirmingDelete && onDeleteFood && (
        <ConfirmDeleteSheet
          title="Delete Food"
          message={`Delete "${food.name}"? Any logs that used it stay in your history.`}
          confirmLabel="Delete Food"
          onConfirm={onDeleteFood}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
