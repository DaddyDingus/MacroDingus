import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Heart, ChevronLeft, ChevronDown, Pencil, PackageOpen, Copy, Trash2 } from "lucide-react";
import ConfirmDeleteSheet from "./ConfirmDeleteSheet";
import type { Food, Nutrition } from "../api/types";
import type { MacroTargets } from "./MacroSummaryBar";
import { scaleNutrition } from "../lib/nutrition";
import { useBackDismiss } from "../lib/useBackDismiss";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import { useLastLoggedQuantity } from "../api/foods";
import NutrientStatusBar, { LogTimePill } from "./NutrientStatusBar";
import { foodMeasures } from "../lib/foodMeasures";
import DecimalKeypad from "./DecimalKeypad";

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
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative w-[46px] h-[46px]">
        <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
          <circle cx="32" cy="32" r={RING_R} strokeWidth={4} className="fill-none stroke-dashboardTrack" />
          <circle
            cx="32"
            cy="32"
            r={RING_R}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={RING_CIRC}
            strokeDashoffset={RING_CIRC * (1 - pctValue / 100)}
            className={`fill-none ${colorClass} transition-[stroke-dashoffset] duration-500 ease-out`}
            stroke="currentColor"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="tabular text-xs font-bold text-white">{fmt(pctValue)}%</span>
        </div>
      </div>
      <span className="text-[10px] tracking-wider uppercase text-white/60">{label}</span>
    </div>
  );
}

// One icon-over-label button in the action row above — MacroFactor-style
// (see this feature's own reference screenshot), swapped in for the old
// two-pill row once a recipe needed up to six actions here, more than a
// pill row could hold without wrapping badly.
function ActionIconButton({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap active:scale-[0.96] transition-all duration-75 select-none ${
        active ? "bg-white text-black" : "bg-white/10 text-white/90 active:bg-white/20"
      }`}
    >
      <span className={active ? "" : "opacity-80 scale-90"}>{icon}</span>
      <span>{label}</span>
    </button>
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


let lastVibrateTime = 0;
// Short vibration on every key tap (including Log Foods/Add) — a no-op
// wherever the Vibration API isn't supported (notably iOS Safari).
// Includes an 80ms debounce to prevent double-vibration when triggered on both touchstart and click.
function triggerHaptic(durationMs = 10) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    const now = Date.now();
    if (now - lastVibrateTime > 80) {
      navigator.vibrate(durationMs);
      lastVibrateTime = now;
    }
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
        onTouchStart={() => triggerHaptic(12)}
        onClick={() => {
          triggerHaptic(12);
          onLeft();
        }}
        disabled={leftDisabled}
        className={`rounded-full text-sm font-semibold h-11 flex items-center justify-center border active:scale-[0.98] transition-all duration-75 select-none ${
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
        onTouchStart={() => triggerHaptic(12)}
        onClick={() => {
          triggerHaptic(12);
          onRight();
        }}
        disabled={rightDisabled}
        className={`rounded-full text-sm font-bold h-11 flex items-center justify-center active:scale-[0.98] transition-all duration-75 select-none ${
          rightDisabled ? "bg-dashboardChip text-muted" : "bg-white text-black"
        }`}
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
  recipeActions,
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
  // Set only for food.source === "recipe" — AddFoodSheet resolves this
  // food's real recipe id (distinct from food.id, see schema.ts's
  // recipes.foodId) and fetches its full ingredient breakdown behind each
  // of these, since this screen only ever has the materialized `foods` row.
  recipeActions?: {
    onEdit: () => void;
    onExplode: () => void;
    onDuplicate: () => void;
  };
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
  // Outer trap for this whole screen — closes it (same as the `‹` header
  // button) on whichever back press reaches this level. See the second
  // useBackDismiss below, right after keypadOpen, for the nested trap that
  // has to sit on top of this one.
  useBackDismiss(true, onBack);

  const [unit, setUnit] = useState("g");
  const [quantityInput, setQuantityInput] = useState(String(initialQuantityGrams ?? 100));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => setUnit("g"), [food.id]);
  // Quantity entry is a custom keypad, not a real <input> — a real one was
  // tried here before and reverted specifically because a back press had
  // nothing keyboard-shaped to close first, so it exited this whole screen
  // in one press instead of dismissing the keypad. A genuine system
  // keyboard gets "first back press closes the IME" for free from the OS,
  // before any JS ever sees a popstate; a custom on-page keypad gets
  // nothing for free, so this second, nested useBackDismiss trap (stacked
  // on top of the one above — see lib/useBackDismiss.ts's own doc on nested
  // traps) replicates it by hand: the first back press while the keypad is
  // open is consumed here and just closes the keypad, and only a second
  // press reaches the outer trap above. Starts open (mirrors the old real
  // input's autoFocus) — arming a trap at mount rather than from the tap
  // that opened this screen is the same pattern the outer trap above
  // already relies on, and it's been fine there.
  const [keypadOpen, setKeypadOpen] = useState(true);
  useBackDismiss(keypadOpen, () => setKeypadOpen(false));

  // Mirrors a real numeric input's own "tap in, existing value is fully
  // selected, first keystroke replaces it" — lets a quantity prefilled from
  // history/editing be overwritten by just typing, no manual backspacing
  // first. Re-arms every time the keypad (re)opens, including the initial
  // mount (keypadOpen starts true), not just on a user tap — there's no
  // real "focus event" to hang this off of since this isn't a real input.
  const [allSelected, setAllSelected] = useState(true);
  useEffect(() => {
    if (keypadOpen) setAllSelected(true);
  }, [keypadOpen]);

  // While the keypad is open, keep Protein Breakdown wholly below the pane
  // instead of allowing a clipped heading to peek above the docked footer.
  // The required reserved height sits after the rings and becomes a subtle
  // "View nutrition details" affordance when there's enough room for it.
  // That makes the variable space caused by a brand/long name functional
  // instead of leaving either a clipped heading or a featureless void. The
  // affordance closes the keypad, which removes the reserved height and lets
  // the larger pane reveal the detailed nutrition sections immediately.
  // The measured block includes the current reservation, so subtract it
  // before calculating the next value; that keeps the ResizeObserver stable
  // instead of the reservation adding and removing its own measured height.
  // Recipe-ingredient mode has no rings and therefore never reserves it.
  const paneRef = useRef<HTMLDivElement>(null);
  const aboveFoldRef = useRef<HTMLDivElement>(null);
  const breakdownGapPx = 4;
  const [impactReservedHeight, setImpactReservedHeight] = useState(0);
  useLayoutEffect(() => {
    if (hideTargetsUi || !keypadOpen) {
      setImpactReservedHeight(0);
      return;
    }
    const paneEl = paneRef.current;
    const foldEl = aboveFoldRef.current;
    if (!paneEl || !foldEl) return;
    const update = () => {
      setImpactReservedHeight((current) => {
        const contentHeightWithoutReservation = foldEl.offsetHeight - current;
        return Math.max(0, Math.round(paneEl.clientHeight - contentHeightWithoutReservation - breakdownGapPx));
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(paneEl);
    observer.observe(foldEl);
    return () => observer.disconnect();
  }, [hideTargetsUi, keypadOpen]);

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

  const units = [
    { key: "g", label: "g", grams: 1 },
    { key: "oz", label: "oz", grams: GRAMS_PER_OZ },
    { key: "lb", label: "lb", grams: GRAMS_PER_LB },
    ...foodMeasures(food).map((measure, index) => ({ key: `measure:${index}`, label: measure.name, grams: measure.grams })),
  ];
  const activeUnit = units.find((candidate) => candidate.key === unit) ?? units[0];
  const gramsPerUnit = activeUnit.grams;
  const quantity = Number(quantityInput) || 0;
  const quantityGrams = Math.max(0, quantity * gramsPerUnit);

  function selectUnit(nextKey: string) {
    const next = units.find((candidate) => candidate.key === nextKey);
    if (!next || next.key === activeUnit.key) return;
    setQuantityInput(String(Number((quantityGrams / next.grams).toFixed(3))));
    setUnit(next.key);
    setAllSelected(true);
  }

  // The custom keypad's own edit ops — plain string-append/trim on
  // quantityInput, same as typing into a real numeric input would produce.
  // A leading "0" is replaced rather than appended to (typing "5" after "0"
  // gives "5", not "05"), matching a real number input's own behavior.
  // allSelected short-circuits all three the same way a real input's
  // selected-range does: the first digit/decimal replaces the whole value
  // instead of appending, and backspace clears it outright instead of
  // trimming one character — either way, selection is consumed after one
  // keystroke, same as a real input never re-selects itself mid-edit.
  function tapDigit(d: string) {
    if (allSelected) {
      setQuantityInput(d);
      setAllSelected(false);
      return;
    }
    setQuantityInput((prev) => (prev === "0" ? d : prev + d));
  }
  function tapDecimal() {
    if (allSelected) {
      setQuantityInput("0.");
      setAllSelected(false);
      return;
    }
    setQuantityInput((prev) => (prev === "" ? "0." : prev.includes(".") ? prev : prev + "."));
  }
  function tapBackspace() {
    if (allSelected) {
      setQuantityInput("");
      setAllSelected(false);
      return;
    }
    setQuantityInput((prev) => prev.slice(0, -1));
  }

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
      <div className="shrink-0" style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)" }}>
        {/* pb-1.5 (6px) — matches BrowseHeader's flex-col gap-3 between its
            own top row and NutrientStatusBar exactly, so the "Remaining
            Today" block lands at the same vertical offset on both screens. */}
        <div className="px-4 pb-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {/* h-5 flex items-center matches BrowseHeader's X button box exactly
              (w-5 h-5 icon) — this glyph alone at text-lg/leading-none rendered
              a couple px shorter, which was enough to shift NutrientStatusBar
              a hair between the two screens despite both sitting the same
              gap below this row. */}
          <button
            onClick={onBack}
            aria-label={backLabel}
            className="justify-self-start shrink-0 h-5 flex items-center text-muted active:text-white px-1 -mx-1"
          >
            <ChevronLeft size={20} strokeWidth={2.2} />
          </button>
          <LogTimePill timeLabel={timeLabel} onTimeClick={onTimeClick} />
          <div />
        </div>
        {!hideTargetsUi && (
          <div className="px-4 pb-1.5">
            <NutrientStatusBar totals={totals} plateTotals={plateTotals} extra={n} targets={targets} />
          </div>
        )}
        <div className="px-6 py-1.5 min-h-[42px] flex flex-col items-center justify-center text-center">
          <span className="min-w-0 max-w-full">
            <span className="block text-base font-semibold leading-tight text-white line-clamp-2">{food.name}</span>
            {food.brand && <span className="block mt-0.5 text-[11px] leading-tight text-muted truncate">{food.brand}</span>}
          </span>
        </div>
      </div>

      <div ref={paneRef} className="flex-1 overflow-y-auto pb-4">
        <div ref={aboveFoldRef}>
        {/* Summary row: strict per-column stack of badge (if any) -> large
            value -> muted label, sized so calories reads as primary without
            dwarfing protein/fat/carbs (2xl vs xl, not the previous 3xl vs
            lg). items-end bottom-aligns the four columns so calories'
            missing badge (there's nothing to take a caloric-ratio "% of
            itself") doesn't throw off the row. */}
        <div className="px-4 pt-1 pb-1.5 grid grid-cols-4 gap-2 items-end">
          <div className="col-span-1">
            <p className="tabular text-2xl font-bold text-calories leading-none">{fmt(kcalToUnit(n.calories, energyUnit))}</p>
            <p className="text-[10px] text-white/60 mt-0.5">{energyUnitLabel(energyUnit)}</p>
          </div>
          {/* Percentage-of-calories pills used to sit above each number here
              — removed as a duplicate of the Impact on Targets rings below,
              which already own percentage visualization for these same three
              macros; this row is now just the plain gram amounts. */}
          {(["protein", "fat", "carbs"] as const).map((key) => {
            const colorClass = key === "protein" ? "text-protein" : key === "fat" ? "text-fat" : "text-carbs";
            return (
              <div key={key} className="text-center">
                <p className={`tabular text-xl font-semibold leading-none ${colorClass}`}>{fmt(n[key], 1)}</p>
                <p className="text-[10px] text-white/60 mt-0.5 capitalize">{key}</p>
              </div>
            );
          })}
        </div>

        {/* Icon-grid action row (MacroFactor-style icon-over-label, not this
            screen's old two equal-width pill buttons) — needed once a
            recipe can carry up to six actions here (Edit/To custom/
            Favourite/Explode/Duplicate/Delete), which never fit one pill
            row. grid-cols-3 rather than flex-wrap so a partial last row
            (e.g. a plain food's just To custom + Favourite) still lines up
            under a full one instead of centering unevenly. "To custom"
            duplicates this food into the create-food form (see
            CreateFoodForm's prefillFood) so a tweak-and-save produces a
            separate new food rather than editing this one; "Favourite" just
            toggles membership in the per-user favorites list surfaced back
            on the search sheet; both apply to every food type. Edit/
            Explode/Duplicate only render when recipeActions is set (i.e.
            food.source === "recipe"); Delete only when onDeleteFood is
            (custom/ai_estimate/afcd foods, or a recipe — see AddFoodSheet's
            wiring), replacing the old standalone "Delete food" button that
            used to sit at the bottom of the whole screen. */}
        <div className="px-4 pb-3 pt-1 flex gap-2 overflow-x-auto no-scrollbar">
          {recipeActions && <ActionIconButton icon={<Pencil className="w-4 h-4" strokeWidth={2.5} />} label="Edit" onClick={recipeActions.onEdit} />}
          <ActionIconButton icon={<Plus className="w-4 h-4" strokeWidth={2.5} />} label="To custom" onClick={() => onSaveAsCustom(food)} />
          <ActionIconButton
            icon={<Heart className="w-4 h-4" strokeWidth={2.5} fill={isFavorite ? "currentColor" : "none"} />}
            label="Favourite"
            onClick={() => onToggleFavorite(food)}
            active={isFavorite}
          />
          {recipeActions && (
            <>
              <ActionIconButton icon={<PackageOpen className="w-4 h-4" strokeWidth={2.5} />} label="Explode" onClick={recipeActions.onExplode} />
              <ActionIconButton icon={<Copy className="w-4 h-4" strokeWidth={2.5} />} label="Duplicate" onClick={recipeActions.onDuplicate} />
            </>
          )}
          {onDeleteFood && <ActionIconButton icon={<Trash2 className="w-4 h-4" strokeWidth={2.5} />} label="Delete" onClick={() => setConfirmingDelete(true)} />}
        </div>

        {/* Impact on Targets — skipped entirely in recipe-picker mode, not
            just the rings: a recipe has no daily target to show impact
            against, so even the "set up targets" fallback text is nonsense
            here. */}
        {!hideTargetsUi && (
          <div className="px-4 pt-1.5 pb-2 border-t border-dashboardDivider/60">
            <p className="text-[13px] font-semibold text-white/80 pt-1.5 pb-2">Impact on Targets</p>
            {targets ? (
              <div className="grid grid-cols-4 gap-2">
                {ringData.map((r) => (
                  <Ring key={r.key} pctValue={r.pctValue} colorClass={r.colorClass} label={r.label} />
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted">Set up daily targets on Strategy to see impact here.</p>
            )}
            {impactReservedHeight >= 28 ? (
              <button
                type="button"
                onClick={() => setKeypadOpen(false)}
                className="w-full flex items-center justify-center gap-1.5 text-[10px] font-medium tracking-wider uppercase text-white/45 active:text-white transition-colors"
                style={{ height: impactReservedHeight }}
              >
                <span>View nutrition details</span>
                <ChevronDown size={13} strokeWidth={2.2} />
              </button>
            ) : impactReservedHeight > 0 ? (
              <div aria-hidden="true" style={{ height: impactReservedHeight }} />
            ) : null}
          </div>
        )}
        </div>
        {/* A consistent breathing gap after Impact. Any dynamic reserved space
            lives inside the section as a useful reveal affordance; see the
            measurement block above. */}
        <div style={{ height: breakdownGapPx }} />

        {/* Detailed nutrient breakdown — plain label + amount rows, grouped
            into categories. Section headers are Title Case (as authored,
            not forced uppercase) with a heavier weight for readability. */}
        <div className="px-4 pt-3">
          <p className="text-[13px] font-semibold text-white/80">Protein Breakdown</p>
          <div>
            <BreakdownRow label="Protein" amount={n.protein} dailyValueRef={DAILY_VALUE_REF.protein} barColorClass="bg-protein" />
          </div>
        </div>

        {/* AFCD only lab-tested amino acids for a subset of its foods (see
            scripts/import-afcd-foods.ts), so this section — like Vitamins/
            Minerals below — simply doesn't render for most foods rather than
            showing an empty or partial-looking list. */}
        {aminoAcids.length > 0 && (
          <div className="px-4 mt-5">
            <p className="text-[13px] font-semibold text-white/80">Amino Acids</p>
            <div>
              {aminoAcids.map((m) => (
                <BreakdownRow key={m.key} label={m.label} amount={m.amount} unit={m.unit} dailyValueRef={m.dailyValue} />
              ))}
            </div>
          </div>
        )}

        <div className="px-4 mt-5">
          <p className="text-[13px] font-semibold text-white/80">Carb Breakdown</p>
          <div>
            <BreakdownRow label="Carbs" amount={n.carbs} dailyValueRef={DAILY_VALUE_REF.carbs} barColorClass="bg-carbs" />
            <BreakdownRow label="Fiber" amount={n.fiber} dailyValueRef={DAILY_VALUE_REF.fiber} barColorClass="bg-carbs" />
            <BreakdownRow label="Sugars" amount={n.sugar} dailyValueRef={DAILY_VALUE_REF.sugar} barColorClass="bg-carbs" />
            {carbDetails.map((m) => (
              <BreakdownRow key={m.key} label={m.label} amount={m.amount} unit={m.unit} dailyValueRef={m.dailyValue} />
            ))}
            <BreakdownRow label="Net Carbs" amount={Math.max(0, n.carbs - n.fiber)} />
          </div>
        </div>

        <div className="px-4 mt-5">
          <p className="text-[13px] font-semibold text-white/80">Fat Breakdown</p>
          <div>
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
          <div className="px-4 mt-5">
            <p className="text-[13px] font-semibold text-white/80">Vitamins</p>
            <div>
              {vitamins.map((m) => (
                <BreakdownRow key={m.key} label={m.label} amount={m.amount} unit={m.unit} dailyValueRef={m.dailyValue} />
              ))}
            </div>
          </div>
        )}

        {minerals.length > 0 && (
          <div className="px-4 mt-5">
            <p className="text-[13px] font-semibold text-white/80">Minerals</p>
            <div>
              {minerals.map((m) => (
                <BreakdownRow key={m.key} label={m.label} amount={m.amount} unit={m.unit} dailyValueRef={m.dailyValue} />
              ))}
            </div>
          </div>
        )}

        <div className="px-4 mt-5">
          <p className="text-[13px] font-semibold text-white/80">Other</p>
          <div>
            <BreakdownRow label="Sodium" amount={n.sodiumMg} unit="mg" dailyValueRef={DAILY_VALUE_REF.sodiumMg} />
            {cholesterolAmount !== null && <BreakdownRow label="Cholesterol" amount={cholesterolAmount} unit="mg" />}
          </div>
        </div>

      </div>

      {/* Docked footer, top to bottom: a tappable quantity display driving a
          custom keypad (not a real input — see keypadOpen's own comment
          above for why, and the back-dismiss trap that makes this safe this
          time), a horizontally scrollable unit carousel, the keypad itself,
          then Log Foods/Add. Always visible without scrolling — a real flex
          sibling after the scrollable pane above (see the fixed gap div
          right after Impact on Targets for how much of the pane's own
          content is visible before this). */}
      <div className="shrink-0 border-t border-dashboardDivider/60 bg-dashboardBg px-4 pt-1 pb-1">
        <button
          type="button"
          onTouchStart={() => triggerHaptic(12)}
          onClick={() => {
            triggerHaptic(12);
            setKeypadOpen((v) => !v);
          }}
          aria-expanded={keypadOpen}
          aria-label="Quantity"
          className={`w-full rounded-xl bg-dashboardCard border transition-all duration-200 px-4 mb-1.5 flex items-center justify-between gap-1.5 active:scale-[0.99] ${
            keypadOpen ? "border-accent h-11" : "border-white/15 h-9"
          }`}
        >
          <span className={`flex items-center tabular font-semibold text-white transition-all duration-200 ${keypadOpen ? "text-lg" : "text-sm"}`}>
            {/* keypadOpen-gated: this is a fake caret/selection on a plain
                <button>, not a real input, so neither should show while
                collapsed (nothing to be "focused" then). allSelected shows
                a selection-style highlight (matches a real input's tap-in
                behavior — see its own comment above) *and* keeps the caret
                visible right after it — a real input wouldn't show both at
                once, but this control has no other affordance telling the
                user it's the thing about to receive taps, so the caret
                stays as a constant "you can type here" signal regardless
                of selection state instead of only appearing after the
                first keystroke. */}
            {keypadOpen && allSelected ? (
              <span className="bg-accent/30 rounded px-0.5 -mx-0.5">{quantityInput}</span>
            ) : (
              quantityInput
            )}
            {keypadOpen && <span className="caret-blink w-[3px] h-[1.1em] bg-white ml-1 shrink-0" />}
          </span>
          <span className="flex items-center gap-1 shrink-0 text-muted">
            <span className="text-xs">{activeUnit.label}</span>
            <ChevronDown size={14} strokeWidth={2.5} className={`transition-transform duration-200 ${keypadOpen ? "rotate-180" : ""}`} />
          </span>
        </button>

        {/* Same outlined-pill treatment as the staged-plate editor's own
            QuantityPresetBar (AddFoodSheet.tsx) — border-accent/text-accent
            selected, border-white/15/text-white otherwise — rather than the
            filled bg-white/bg-dashboardChip pair this used to have, so the
            two serving-size pill rows read as one consistent control instead
            of two different designs depending on which screen you're on.
            Collapsed via the grid-template-rows 0fr/1fr trick (CoachScreen's
            narrative section uses the same one) whenever the keypad is
            closed — hidden rather than always-on so the footer takes less
            permanent space, without an abrupt height jump when it reopens.
            The keypad grid below shares this same collapsible wrapper so
            both animate open/closed together. */}
        <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: keypadOpen ? "1fr" : "0fr" }}>
          <div className="overflow-hidden">
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3">
              {units.map((u) => (
                <button
                  key={u.key}
                  onTouchStart={() => triggerHaptic(10)}
                  onClick={() => {
                    triggerHaptic(10);
                    selectUnit(u.key);
                  }}
                  className={`shrink-0 h-8 rounded-full px-3.5 border text-xs font-medium whitespace-nowrap flex items-center justify-center transition-all duration-75 active:scale-[0.96] select-none ${
                    unit === u.key ? "border-accent text-accent bg-accent/[0.06]" : "border-white/10 text-white/80 active:bg-white/5"
                  }`}
                >
                  {u.label}
                </button>
              ))}
            </div>

            {/* Fixed-height 3x4 grid, unlike a real system keyboard's
                unpredictable (and per-device-variable) height — this is
                what actually lets the rest of the screen budget space for
                itself reliably above it. */}
            <div className="pb-3">
              <DecimalKeypad onDigit={tapDigit} onDecimal={tapDecimal} onBackspace={tapBackspace} />
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
