import { useState } from "react";
import type { Food, Nutrition } from "../api/types";
import type { MacroTargets } from "./MacroSummaryBar";
import { scaleNutrition } from "../lib/nutrition";
import FoodIconAvatar from "./FoodIconAvatar";

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

// FDA Nutrition Facts label %DV reference amounts (for a 2,000-calorie
// diet) — not a personalized target the way calories/protein/fat/carbs are
// (this app doesn't track per-user protein/fiber/sugar/sodium/vitamin/
// mineral goals), but a defensible, standard reference rather than an
// invented number. Net carbs, "other fat," and the mono/poly/omega/trans fat
// rows intentionally have no reference — none is a defined %DV line on a
// real nutrition label (only Total Fat and Saturated Fat get one; Trans Fat
// has no established safe threshold so the FDA never assigned it one
// either), and cholesterol's %DV was removed from the FDA label entirely in
// the 2016 revision, so it gets the same no-bar treatment.
const DAILY_VALUE_REF = { protein: 50, fiber: 28, sugar: 50, saturatedFat: 20, sodiumMg: 2300 };

interface MicroMeta {
  label: string;
  unit: string;
  toDisplay: (grams: number) => number;
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
// can each just object-filter against their own list directly. FDA %DV
// reference values are the same standard 2,000-kcal-diet table as
// DAILY_VALUE_REF above, just for nutrients that don't get a dedicated
// column.
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
// grouping CreateFoodForm uses.
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
// o'clock a bare <circle> stroke-dasharray starts from.
function Ring({ pctValue, colorClass, label, value }: { pctValue: number; colorClass: string; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-16 h-16">
        <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
          <circle cx="32" cy="32" r={RING_R} strokeWidth={5} className="fill-none stroke-dashboardTrack" />
          <circle
            cx="32"
            cy="32"
            r={RING_R}
            strokeWidth={5}
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
      <span className="tabular text-[11px] text-white">{value}</span>
    </div>
  );
}

// One row of a breakdown section — dailyValueRef omitted (Net Carbs, Other
// Fat, Cholesterol) means there's no standard %DV line for it, so the row
// shows just the amount with no bar rather than a fabricated percentage.
// barColorClass ties each section's bars to that macro's established
// categorical color (bg-protein/bg-carbs/bg-fat, same hex values used
// everywhere else in the app) rather than a generic neutral bar — vitamins
// and minerals aren't one of those four established categories, so they
// keep the neutral bar rather than being assigned an unvalidated new color.
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
          {percent !== null && <span className="ml-1.5 text-[11px]">{fmt(percent)}% DV</span>}
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

const KEYPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

export default function FoodDetailScreen({
  food,
  totals,
  targets,
  onBack,
  onAdd,
}: {
  food: Food;
  totals?: Nutrition;
  targets?: MacroTargets | null;
  onBack: () => void;
  onAdd: (food: Food, quantityGrams: number) => void;
}) {
  const hasServing = food.servingSizeGrams != null;
  const [unit, setUnit] = useState<Unit>("g");
  const [quantityInput, setQuantityInput] = useState("100");
  const [keypadOpen, setKeypadOpen] = useState(false);

  const units: Unit[] = hasServing ? ["g", "oz", "lb", "serving"] : ["g", "oz", "lb"];

  const gramsPerUnit = unit === "oz" ? GRAMS_PER_OZ : unit === "lb" ? GRAMS_PER_LB : unit === "serving" ? food.servingSizeGrams ?? 100 : 1;
  const quantity = Number(quantityInput) || 0;
  const quantityGrams = Math.max(0, quantity * gramsPerUnit);

  const n = scaleNutrition(food, quantityGrams);
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
    const thisServing = n[m.key];
    return {
      ...m,
      pctValue: targets ? pct(thisServing, remaining) : 0,
      value: m.key === "calories" ? fmt(thisServing) : `${fmt(thisServing, 1)}g`,
    };
  });

  function tapKey(key: string) {
    setQuantityInput((prev) => {
      if (key === "⌫") return prev.length > 1 ? prev.slice(0, -1) : "0";
      if (key === "." && prev.includes(".")) return prev;
      if (prev === "0" && key !== ".") return key;
      return prev + key;
    });
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto pb-4">
        {/* Header */}
        <div className="px-4 pt-4 pb-2 flex items-center gap-3">
          <button onClick={onBack} aria-label="Back to search results" className="text-muted text-lg leading-none px-1 shrink-0">
            ‹
          </button>
          <FoodIconAvatar name={food.name} />
          <span className="min-w-0">
            <span className="block text-base font-semibold text-white truncate">{food.name}</span>
            {food.brand && <span className="block text-[11px] text-muted truncate">{food.brand}</span>}
          </span>
        </div>

        {/* Summary row: big calorie number + protein/fat/carbs with caloric-ratio badges */}
        <div className="px-4 pt-2 pb-4 grid grid-cols-4 gap-2 items-end">
          <div className="col-span-1">
            <p className="tabular text-3xl font-bold text-calories leading-none">{fmt(n.calories)}</p>
            <p className="text-[10px] text-muted mt-1">kcal</p>
          </div>
          {(["protein", "fat", "carbs"] as const).map((key) => {
            const cal = key === "protein" ? n.protein * 4 : key === "fat" ? n.fat * 9 : n.carbs * 4;
            return (
              <div key={key} className="text-center">
                <p className={`text-[10px] font-medium ${key === "protein" ? "text-protein" : key === "fat" ? "text-fat" : "text-carbs"}`}>
                  {caloricRatio(cal)}%
                </p>
                <p className="tabular text-lg font-semibold text-white leading-none mt-1">{fmt(n[key], 1)}</p>
                <p className="text-[10px] text-muted mt-0.5 capitalize">{key}</p>
              </div>
            );
          })}
        </div>

        {/* Impact on Targets */}
        <div className="px-4 pt-2 pb-4 border-t border-dashboardDivider">
          <p className="text-[11px] tracking-widest uppercase text-muted pt-3 pb-3">Impact on Targets</p>
          {targets ? (
            <div className="grid grid-cols-4 gap-2">
              {ringData.map((r) => (
                <Ring key={r.key} pctValue={r.pctValue} colorClass={r.colorClass} label={r.label} value={r.value} />
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted">Set up daily targets on Strategy to see impact here.</p>
          )}
        </div>

        {/* Detailed nutrient breakdown — each section's bar color matches
            that macro's established categorical color from the rest of the
            app (bg-protein/bg-carbs/bg-fat), not a generic neutral bar. */}
        <div className="px-4 pt-2 border-t border-dashboardDivider">
          <p className="text-[11px] tracking-widest uppercase text-muted pt-3">Protein Breakdown</p>
          <div className="divide-y divide-dashboardDivider/60">
            <BreakdownRow label="Protein" amount={n.protein} dailyValueRef={DAILY_VALUE_REF.protein} barColorClass="bg-protein" />
          </div>
        </div>

        <div className="px-4 pt-4 border-t border-dashboardDivider mt-4">
          <p className="text-[11px] tracking-widest uppercase text-muted pt-3">Carb Breakdown</p>
          <div className="divide-y divide-dashboardDivider/60">
            <BreakdownRow label="Fiber" amount={n.fiber} dailyValueRef={DAILY_VALUE_REF.fiber} barColorClass="bg-carbs" />
            <BreakdownRow label="Sugars" amount={n.sugar} dailyValueRef={DAILY_VALUE_REF.sugar} barColorClass="bg-carbs" />
            <BreakdownRow label="Net Carbs" amount={Math.max(0, n.carbs - n.fiber)} />
          </div>
        </div>

        <div className="px-4 pt-4 border-t border-dashboardDivider mt-4">
          <p className="text-[11px] tracking-widest uppercase text-muted pt-3">Fat Breakdown</p>
          <div className="divide-y divide-dashboardDivider/60">
            <BreakdownRow label="Saturated Fat" amount={n.saturatedFat} dailyValueRef={DAILY_VALUE_REF.saturatedFat} barColorClass="bg-fat" />
            {monounsaturated !== null && <BreakdownRow label="Monounsaturated" amount={monounsaturated} barColorClass="bg-fat" />}
            {polyunsaturated !== null && <BreakdownRow label="Polyunsaturated" amount={polyunsaturated} barColorClass="bg-fat" />}
            {omega3 !== null && <BreakdownRow label="Omega-3" amount={omega3} barColorClass="bg-fat" />}
            {omega6 !== null && <BreakdownRow label="Omega-6" amount={omega6} barColorClass="bg-fat" />}
            {transFat !== null && <BreakdownRow label="Trans Fat" amount={transFat} barColorClass="bg-fat" />}
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
            <p className="text-[11px] tracking-widest uppercase text-muted pt-3">Vitamins</p>
            <div className="divide-y divide-dashboardDivider/60">
              {vitamins.map((m) => (
                <BreakdownRow key={m.key} label={m.label} amount={m.amount} unit={m.unit} dailyValueRef={m.dailyValue} />
              ))}
            </div>
          </div>
        )}

        {minerals.length > 0 && (
          <div className="px-4 pt-4 border-t border-dashboardDivider mt-4">
            <p className="text-[11px] tracking-widest uppercase text-muted pt-3">Minerals</p>
            <div className="divide-y divide-dashboardDivider/60">
              {minerals.map((m) => (
                <BreakdownRow key={m.key} label={m.label} amount={m.amount} unit={m.unit} dailyValueRef={m.dailyValue} />
              ))}
            </div>
          </div>
        )}

        <div className="px-4 pt-4 border-t border-dashboardDivider mt-4">
          <p className="text-[11px] tracking-widest uppercase text-muted pt-3">Other</p>
          <div className="divide-y divide-dashboardDivider/60">
            <BreakdownRow label="Sodium" amount={n.sodiumMg} unit="mg" dailyValueRef={DAILY_VALUE_REF.sodiumMg} />
            {cholesterolAmount !== null && <BreakdownRow label="Cholesterol" amount={cholesterolAmount} unit="mg" />}
          </div>
        </div>
      </div>

      {/* Sticky footer: quantity + unit + Add, expanding into a custom keypad
          on tap instead of the system keyboard (per the request) — this app
          reads the value from the same on-screen buffer either way, so
          there's never a native keyboard to fight with here. */}
      <div className="shrink-0 border-t border-white/10 bg-dashboardBg">
        {keypadOpen && (
          <div className="px-4 pt-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {units.map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-medium ${
                    unit === u ? "bg-white text-black" : "bg-dashboardChip text-muted"
                  }`}
                >
                  {u === "serving" ? (food.servingName ?? "serving") : u}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 pb-3">
              {KEYPAD_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => tapKey(key)}
                  className="py-3 rounded-xl bg-dashboardChip text-white text-lg font-medium active:bg-white/10"
                >
                  {key}
                </button>
              ))}
            </div>
            <button
              onClick={() => setKeypadOpen(false)}
              className="w-full py-2.5 mb-3 rounded-full border border-white/15 text-sm font-medium text-white active:bg-white/5"
            >
              Done
            </button>
          </div>
        )}

        {!keypadOpen && (
          <div className="flex items-center gap-2 px-4 py-3">
            <button
              onClick={() => setKeypadOpen(true)}
              className="shrink-0 flex items-center gap-1.5 rounded-full bg-dashboardChip px-4 py-2.5"
            >
              <span className="tabular text-sm text-white">{quantityInput}</span>
              <span className="text-xs text-muted">{unit === "serving" ? (food.servingName ?? "serving") : unit}</span>
            </button>
            <div className="flex-1 flex items-center gap-1.5 overflow-x-auto">
              {units.map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium ${
                    unit === u ? "bg-white text-black" : "bg-dashboardChip text-muted"
                  }`}
                >
                  {u === "serving" ? (food.servingName ?? "serving") : u}
                </button>
              ))}
            </div>
            <button
              onClick={() => onAdd(food, quantityGrams)}
              disabled={quantityGrams <= 0}
              className="shrink-0 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black disabled:opacity-50"
            >
              Add to Plate
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
