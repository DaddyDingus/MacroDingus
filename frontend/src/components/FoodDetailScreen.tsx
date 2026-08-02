import { useEffect, useState } from "react";
import { Plus, Heart } from "lucide-react";
import ConfirmDeleteSheet from "./ConfirmDeleteSheet";
import type { Food, Nutrition } from "../api/types";
import type { MacroTargets } from "./MacroSummaryBar";
import { scaleNutrition } from "../lib/nutrition";
import { useBackDismiss } from "../lib/useBackDismiss";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import { useLastLoggedQuantity } from "../api/foods";
import NutrientStatusBar, { LogTimePill } from "./NutrientStatusBar";

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
const DAILY_VALUE_REF = { protein: 50, carbs: 275, fat: 78, fiber: 28, sugar: 50, saturatedFat: 20, sodiumMg: 2300 };

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

// foods.aminoAcidsJson — same {key: grams-per-100g} convention as
// microsJson, currently only populated by the AFCD seed
// (scripts/import-afcd-foods.ts). No dailyValue for any of these: there's
// no FDA %DV reference for an individual amino acid the way there is for
// protein as a whole, so every row here renders label+amount with no bar,
// same as Cholesterol above.
const AMINO_ACID_META: Record<string, MicroMeta> = {
  "alanine_100g": { label: "Alanine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "arginine_100g": { label: "Arginine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "aspartic-acid_100g": { label: "Aspartic acid", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "cystine-plus-cysteine_100g": { label: "Cystine + Cysteine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "glutamic-acid_100g": { label: "Glutamic acid", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "glycine_100g": { label: "Glycine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "histidine_100g": { label: "Histidine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "isoleucine_100g": { label: "Isoleucine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "leucine_100g": { label: "Leucine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "lysine_100g": { label: "Lysine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "methionine_100g": { label: "Methionine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "phenylalanine_100g": { label: "Phenylalanine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "proline_100g": { label: "Proline", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "serine_100g": { label: "Serine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "threonine_100g": { label: "Threonine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "tyrosine_100g": { label: "Tyrosine", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "tryptophan_100g": { label: "Tryptophan", unit: "mg", toDisplay: MG_TO_DISPLAY },
  "valine_100g": { label: "Valine", unit: "mg", toDisplay: MG_TO_DISPLAY },
};

// foods.carbDetailJson — curated subset of AFCD's much larger sugar/starch
// breakdown (fructose/glucose/sucrose/lactose/maltose/galactose/starch);
// the rest (sugar alcohols, dextrin, glycogen, inulin, etc.) were left out
// as more food-science-y than a household tracker needs — easy to extend
// later. No dailyValue, same reasoning as amino acids above.
const CARB_DETAIL_META: Record<string, MicroMeta> = {
  "fructose_100g": { label: "Fructose", unit: "g", toDisplay: (g) => g },
  "glucose_100g": { label: "Glucose", unit: "g", toDisplay: (g) => g },
  "sucrose_100g": { label: "Sucrose", unit: "g", toDisplay: (g) => g },
  "lactose_100g": { label: "Lactose", unit: "g", toDisplay: (g) => g },
  "maltose_100g": { label: "Maltose", unit: "g", toDisplay: (g) => g },
  "galactose_100g": { label: "Galactose", unit: "g", toDisplay: (g) => g },
  "starch_100g": { label: "Starch", unit: "g", toDisplay: (g) => g },
};

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
      <span className="text-[10px] tracking-widest uppercase text-white/60">{label}</span>
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
      {/* Explicit background/text/border swap rather than an opacity dim on a
          permanently-chip-colored button — at 0/empty this read identically
          to a disabled control even while tappable, since disabled:opacity-40
          was the only signal telling the two states apart. A lighter fill
          plus a faint accent border once there's a valid amount now marks
          "active and interactive" the same explicit way the right key
          already does with its own white/chip swap. */}
      <button
        onClick={() => {
          triggerHaptic(15);
          onLeft();
        }}
        disabled={leftDisabled}
        className={`rounded-lg text-sm font-semibold py-3.5 border ${
          leftDisabled
            ? "bg-dashboardChip text-muted border-transparent opacity-40"
            : "bg-white/10 text-white border-accent/40"
        }`}
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
  commitLabel = "Log Foods",
  hideTargetsUi = false,
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
  // Overrides the numpad's left-key copy — factually wrong as "Log Foods"
  // once the caller isn't actually logging anything (e.g. RecipeForm's
  // ingredient picker).
  commitLabel?: string;
  // Set by AddFoodSheet's recipe-picker mode (onPickItems) — hides the
  // "Remaining Today" macro-bar row and the "Impact on Targets" rings/
  // fallback text entirely, rather than showing them empty/meaningless: a
  // recipe has no daily target and no "today" to be remaining against.
  hideTargetsUi?: boolean;
}) {
  // Nested on top of AddFoodSheet's own outer back-dismiss trap — the real
  // quantity input below pops the system keyboard, and this consumes
  // gesture-back's first press to close that (same as the `‹` header
  // button) before a second press reaches the outer trap.
  useBackDismiss(true, onBack);

  const hasServing = food.servingSizeGrams != null;
  const [unit, setUnit] = useState<Unit>("g");
  const [quantityInput, setQuantityInput] = useState(String(initialQuantityGrams ?? 100));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [quantityFocused, setQuantityFocused] = useState(false);

  // Prefills a *new* log's quantity from this food's own log history — only
  // when there's no already-known quantity to seed from (i.e. not editing;
  // `editing` always seeds initialQuantityGrams synchronously from the real
  // entry, see the prop doc below). Not a lazy useState initializer since
  // the fetch is async and this same component instance is reused across
  // different foods (AddFoodSheet doesn't remount FoodDetailScreen per
  // food) — a real effect keeps quantityInput in sync with whichever food
  // is current, falling back to the flat 100 default once resolved if this
  // food has never been logged before.
  const lastQuantity = useLastLoggedQuantity(food.id, !editing);
  useEffect(() => {
    if (editing) return;
    setQuantityInput(String(lastQuantity.data?.quantityGrams ?? initialQuantityGrams ?? 100));
  }, [food.id, lastQuantity.data, editing, initialQuantityGrams]);

  const units: Unit[] = hasServing ? ["g", "oz", "lb", "serving"] : ["g", "oz", "lb"];
  const unitLabel = (u: Unit) => (u === "serving" ? food.servingName ?? "serving" : u);

  const gramsPerUnit = unit === "oz" ? GRAMS_PER_OZ : unit === "lb" ? GRAMS_PER_LB : unit === "serving" ? food.servingSizeGrams ?? 100 : 1;
  const quantity = Number(quantityInput) || 0;
  const quantityGrams = Math.max(0, quantity * gramsPerUnit);

  const n = scaleNutrition(food, quantityGrams);
  const { unit: energyUnit } = useEnergyUnit();

  // Only the keys this specific food actually has data for — see
  // parseMicros/VITAMIN_META/MINERAL_META above for why missing keys are
  // skipped rather than shown as zero. Generic over which JSON blob
  // (microsJson/aminoAcidsJson/carbDetailJson) since all three share the
  // same {key: grams-per-100g} shape.
  const scaleFactor = quantityGrams / 100;
  function jsonList(rawJson: string | null, meta: Record<string, MicroMeta>) {
    const parsed = parseMicros(rawJson);
    return Object.entries(parsed)
      .filter(([key]) => key in meta)
      .map(([key, rawPer100g]) => ({ key, ...meta[key], amount: meta[key].toDisplay(rawPer100g * scaleFactor) }));
  }
  const vitamins = jsonList(food.microsJson, VITAMIN_META);
  const minerals = jsonList(food.microsJson, MINERAL_META);
  const aminoAcids = jsonList(food.aminoAcidsJson, AMINO_ACID_META);
  const carbDetails = jsonList(food.carbDetailJson, CARB_DETAIL_META);
  const parsedMicros = parseMicros(food.microsJson);
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
    // step-enter (the same fade + slight horizontal slide GoalWizardScreen's
    // steps use, see index.css) — this screen used to just appear instantly
    // the instant `step` flipped to "detail" in AddFoodSheet, since a plain
    // conditional swap between sibling steps has no transition of its own.
    // Safe to use a transform here (unlike AddFoodSheet's own outer wrapper,
    // which deliberately avoids one) because this screen has no position:fixed
    // descendants of its own — ConfirmDeleteSheet is built on BottomSheet,
    // which portals straight to document.body, so it's never actually nested
    // under this div in the real DOM regardless of what the JSX looks like.
    <div className="flex-1 flex flex-col min-h-0 step-enter">
      {/* Persistent header — pulled out of the scrollable region below (it
          used to live inside it and scroll away with the rest of the
          breakdown, along with the back button). NutrientStatusBar is the
          same "Remaining Today" macro-bar row the search sheet shows (see
          AddFoodSheet's BrowseHeader) — drilling into a food's own nutrition
          breakdown shouldn't mean losing sight of what's actually left for
          the day. The back button and time pill share one top row (mirroring
          BrowseHeader's X-button/time-pill/avatar-stack row — grid-cols-3
          with the outer columns equal width keeps the pill genuinely
          centered regardless of what sits in either side column, rather than
          the pill sitting stacked directly above NutrientStatusBar's own
          "Remaining Today" label, which read as cramped) so the bars land at
          the same vertical offset in both places despite the two screens
          having different top-row controls. pt accounts for the status
          bar/notch the same way BrowseHeader's does, since this sits at the
          very top of the same full-screen modal once "detail" is the active
          step. */}
      <div className="shrink-0" style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}>
        {/* pb-3 (12px) — matches BrowseHeader's flex-col gap-3 between its
            own top row and NutrientStatusBar exactly, so the "Remaining
            Today" block lands at the same vertical offset on both screens. */}
        <div className="px-4 pb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {/* h-5 flex items-center matches BrowseHeader's X button box exactly
              (w-5 h-5 icon) — this glyph alone at text-lg/leading-none rendered
              a couple px shorter, which was enough to shift NutrientStatusBar
              a hair between the two screens despite both sitting the same
              gap below this row. */}
          <button
            onClick={onBack}
            aria-label={backLabel}
            className="justify-self-start shrink-0 h-5 flex items-center text-muted text-lg leading-none px-1 -mx-1"
          >
            ‹
          </button>
          <LogTimePill timeLabel={timeLabel} onTimeClick={onTimeClick} />
          <div />
        </div>
        {!hideTargetsUi && (
          <div className="px-4 pb-3">
            <NutrientStatusBar totals={totals} plateTotals={plateTotals} extra={n} targets={targets} />
          </div>
        )}
        <div className="px-4 pb-2 flex flex-col items-center text-center">
          <span className="min-w-0 max-w-full">
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
            <p className="text-[10px] text-white/60 mt-1.5">{energyUnitLabel(energyUnit)}</p>
          </div>
          {/* Percentage-of-calories pills used to sit above each number here
              — removed as a duplicate of the Impact on Targets rings below,
              which already own percentage visualization for these same three
              macros; this row is now just the plain gram amounts. */}
          {(["protein", "fat", "carbs"] as const).map((key) => (
            <div key={key} className="text-center">
              <p className="tabular text-xl font-semibold text-white leading-none">{fmt(n[key], 1)}</p>
              <p className="text-[10px] text-white/60 mt-0.5 capitalize">{key}</p>
            </div>
          ))}
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

        {/* Impact on Targets — skipped entirely in recipe-picker mode, not
            just the rings: a recipe has no daily target to show impact
            against, so even the "set up targets" fallback text is nonsense
            here. */}
        {!hideTargetsUi && (
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
        )}

        {/* Detailed nutrient breakdown — plain label + amount rows, grouped
            into categories. Section headers are Title Case (as authored,
            not forced uppercase) with a heavier weight for readability. */}
        <div className="px-4 pt-2 border-t border-dashboardDivider">
          <p className="text-[13px] font-semibold text-white/80 pt-3">Protein Breakdown</p>
          <div className="divide-y divide-dashboardDivider/60">
            <BreakdownRow label="Protein" amount={n.protein} dailyValueRef={DAILY_VALUE_REF.protein} barColorClass="bg-protein" />
          </div>
        </div>

        {/* AFCD only lab-tested amino acids for a subset of its foods (see
            scripts/import-afcd-foods.ts), so this section — like Vitamins/
            Minerals below — simply doesn't render for most foods rather than
            showing an empty or partial-looking list. */}
        {aminoAcids.length > 0 && (
          <div className="px-4 pt-4 border-t border-dashboardDivider mt-4">
            <p className="text-[13px] font-semibold text-white/80 pt-3">Amino Acids</p>
            <div className="divide-y divide-dashboardDivider/60">
              {aminoAcids.map((m) => (
                <BreakdownRow key={m.key} label={m.label} amount={m.amount} unit={m.unit} dailyValueRef={m.dailyValue} />
              ))}
            </div>
          </div>
        )}

        <div className="px-4 pt-4 border-t border-dashboardDivider mt-4">
          <p className="text-[13px] font-semibold text-white/80 pt-3">Carb Breakdown</p>
          <div className="divide-y divide-dashboardDivider/60">
            <BreakdownRow label="Carbs" amount={n.carbs} dailyValueRef={DAILY_VALUE_REF.carbs} barColorClass="bg-carbs" />
            <BreakdownRow label="Fiber" amount={n.fiber} dailyValueRef={DAILY_VALUE_REF.fiber} barColorClass="bg-carbs" />
            <BreakdownRow label="Sugars" amount={n.sugar} dailyValueRef={DAILY_VALUE_REF.sugar} barColorClass="bg-carbs" />
            {carbDetails.map((m) => (
              <BreakdownRow key={m.key} label={m.label} amount={m.amount} unit={m.unit} dailyValueRef={m.dailyValue} />
            ))}
            <BreakdownRow label="Net Carbs" amount={Math.max(0, n.carbs - n.fiber)} />
          </div>
        </div>

        <div className="px-4 pt-4 border-t border-dashboardDivider mt-4">
          <p className="text-[13px] font-semibold text-white/80 pt-3">Fat Breakdown</p>
          <div className="divide-y divide-dashboardDivider/60">
            <BreakdownRow label="Fat" amount={n.fat} dailyValueRef={DAILY_VALUE_REF.fat} barColorClass="bg-fat" />
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

        {(food.source === "custom" || food.source === "ai_estimate" || food.source === "afcd") && onDeleteFood && (
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
            type="search"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            value={quantityInput}
            onChange={(e) => setQuantityInput(e.target.value)}
            onFocus={() => setQuantityFocused(true)}
            onBlur={() => setQuantityFocused(false)}
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

        {/* Same outlined-pill treatment as the staged-plate editor's own
            QuantityPresetBar (AddFoodSheet.tsx) — border-accent/text-accent
            selected, border-white/15/text-white otherwise — rather than the
            filled bg-white/bg-dashboardChip pair this used to have, so the
            two serving-size pill rows read as one consistent control instead
            of two different designs depending on which screen you're on.
            Collapsed via the grid-template-rows 0fr/1fr trick (CoachScreen's
            narrative section uses the same one) whenever the quantity input
            isn't focused — hidden rather than always-on so the footer takes
            less permanent space when the keyboard's down, without an
            abrupt height jump when it reappears. Each pill needs
            onMouseDown preventDefault so tapping one doesn't itself blur the
            input (which would hide the very row being tapped mid-tap) —
            same trick LogWeightInline's body-fat toggle already uses to keep
            the keyboard from dismissing on tap. */}
        <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: quantityFocused ? "1fr" : "0fr" }}>
          <div className="overflow-hidden">
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2.5">
              {units.map((u) => (
                <button
                  key={u}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setUnit(u)}
                  className={`shrink-0 rounded-full px-3.5 py-2 border text-xs font-medium whitespace-nowrap transition-colors ${
                    unit === u ? "border-accent text-accent" : "border-white/15 text-white active:bg-white/5"
                  }`}
                >
                  {unitLabel(u)}
                </button>
              ))}
            </div>
          </div>
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
                ? `${commitLabel} (${stagedCount + (quantityGrams > 0 ? 1 : 0)})`
                : commitLabel
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
