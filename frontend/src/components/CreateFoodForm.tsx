import { useRef, useState, type ReactNode } from "react";
import { Camera, ChevronLeft, Loader2, Pencil } from "lucide-react";
import type { CreateFoodInput, Food, LabelScanResult } from "../api/types";
import { useEnergyUnit, kcalToUnit, unitToKcal, energyUnitLabel, type EnergyUnit } from "../lib/energyUnit";
import { getFoodIcon } from "../lib/foodEmoji";
import IconPickerModal from "./IconPickerModal";
import PhotoSourceSheet from "./PhotoSourceSheet";
import { useScanNutritionLabel } from "../api/foods";

function displayFromGrams(unit: "mg" | "mcg", grams: number): number {
  return unit === "mg" ? grams * 1_000 : grams * 1_000_000;
}

function parseMicrosJson(microsJson: string | null): Record<string, number> {
  if (!microsJson) return {};
  try {
    const parsed = JSON.parse(microsJson);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  labelClassName = "text-muted",
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: ReactNode;
  // Macro fields pass their brand color (text-calories/protein/carbs/fat) so
  // the four inputs read as the same calories/protein/carbs/fat set every
  // other screen in the app color-codes, instead of four identical gray
  // labels indistinguishable from Fiber/Sodium/etc below them.
  labelClassName?: string;
  // Every call site in this form passes the same submit() — plain onKeyDown
  // per field rather than wrapping the form in a <form> element, which is
  // what was actually triggering Chrome's full autofill accessory strip
  // (passwords/payment/addresses icons) on Android for Quick Add's identical
  // shape; see AddFoodSheet's QuickAddTab for the fuller story.
  onEnter?: () => void;
}) {
  return (
    <label className="block">
      <span className={`block text-xs font-medium mb-1 ${labelClassName}`}>{label}</span>
      <div className="flex items-center rounded-md bg-surface-raised border border-line px-3 focus-within:border-accent">
        <input
          type="search"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onEnter ? (e) => { if (e.key === "Enter") onEnter(); } : undefined}
          className="tabular w-full bg-transparent py-2.5 text-sm focus:outline-none"
        />
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
      </div>
    </label>
  );
}

// Fat subtypes are real CreateFoodInput columns (see schema.ts — a small,
// closed set, unlike the open-ended vitamin/mineral list below), already in
// grams like every other per-100g field in this form, so no unit conversion
// needed at submit time.
const FAT_SUBTYPE_FIELDS: { key: "saturatedFatPer100g" | "monounsaturatedFatPer100g" | "polyunsaturatedFatPer100g" | "transFatPer100g" | "omega3Per100g" | "omega6Per100g"; label: string }[] = [
  { key: "saturatedFatPer100g", label: "Saturated" },
  { key: "monounsaturatedFatPer100g", label: "Monounsaturated" },
  { key: "polyunsaturatedFatPer100g", label: "Polyunsaturated" },
  { key: "transFatPer100g", label: "Trans fat" },
  { key: "omega3Per100g", label: "Omega-3" },
  { key: "omega6Per100g", label: "Omega-6" },
];

// Vitamins/minerals go into CreateFoodInput's `micros` bag (same OFF-style
// keys FoodDetailScreen's MICRO_META already expects — see that file and
// backend/src/engine/openfoodfacts.ts's MICRO_KEYS), not their own columns.
// Entered here in whatever unit a real nutrition label actually uses
// (mg/mcg), then converted to the grams-per-100g-equivalent the storage
// format uses at submit time — everywhere else in the app that reads
// microsJson expects grams, and getting this conversion wrong would produce
// values that are wrong, not just missing.
interface MicroFieldMeta {
  key: string;
  label: string;
  unit: "mg" | "mcg";
  toGrams: (displayValue: number) => number;
}
const MG = (v: number) => v / 1_000;
const MCG = (v: number) => v / 1_000_000;
const MICRO_FIELD_GROUPS: { category: string; fields: MicroFieldMeta[] }[] = [
  {
    category: "Vitamins",
    fields: [
      { key: "vitamin-a_100g", label: "Vitamin A", unit: "mcg", toGrams: MCG },
      { key: "vitamin-c_100g", label: "Vitamin C", unit: "mg", toGrams: MG },
      { key: "vitamin-d_100g", label: "Vitamin D", unit: "mcg", toGrams: MCG },
      { key: "vitamin-e_100g", label: "Vitamin E", unit: "mg", toGrams: MG },
      { key: "vitamin-k_100g", label: "Vitamin K", unit: "mcg", toGrams: MCG },
      { key: "vitamin-b1_100g", label: "B1 (Thiamin)", unit: "mg", toGrams: MG },
      { key: "vitamin-b2_100g", label: "B2 (Riboflavin)", unit: "mg", toGrams: MG },
      { key: "vitamin-pp_100g", label: "B3 (Niacin)", unit: "mg", toGrams: MG },
      { key: "vitamin-b6_100g", label: "B6", unit: "mg", toGrams: MG },
      { key: "vitamin-b9_100g", label: "B9 (Folate)", unit: "mcg", toGrams: MCG },
      { key: "vitamin-b12_100g", label: "B12", unit: "mcg", toGrams: MCG },
    ],
  },
  {
    category: "Minerals",
    fields: [
      { key: "calcium_100g", label: "Calcium", unit: "mg", toGrams: MG },
      { key: "iron_100g", label: "Iron", unit: "mg", toGrams: MG },
      { key: "magnesium_100g", label: "Magnesium", unit: "mg", toGrams: MG },
      { key: "potassium_100g", label: "Potassium", unit: "mg", toGrams: MG },
      { key: "zinc_100g", label: "Zinc", unit: "mg", toGrams: MG },
      { key: "phosphorus_100g", label: "Phosphorus", unit: "mg", toGrams: MG },
      { key: "copper_100g", label: "Copper", unit: "mg", toGrams: MG },
      { key: "manganese_100g", label: "Manganese", unit: "mg", toGrams: MG },
      { key: "selenium_100g", label: "Selenium", unit: "mcg", toGrams: MCG },
      { key: "iodine_100g", label: "Iodine", unit: "mcg", toGrams: MCG },
    ],
  },
  {
    category: "Other",
    fields: [{ key: "cholesterol_100g", label: "Cholesterol", unit: "mg", toGrams: MG }],
  },
];

// Numeric-or-null food field -> the string a NumberField expects, blank when
// unreported rather than showing a fabricated "0".
const numToStr = (n: number | null | undefined): string => (n == null ? "" : String(n));

export default function CreateFoodForm({
  initialName,
  barcode,
  prefillFood,
  onCancel,
  onCreated,
}: {
  initialName: string;
  barcode?: string;
  // Seeds every field from an existing food's own nutrition data — used by
  // Food Detail's "To custom" button to let editing-then-saving produce a
  // genuinely separate new food rather than overwriting the original.
  // Deliberately excludes barcode (a separate `barcode` prop, left unset by
  // that caller): POST /api/foods reuses/updates the existing row for a
  // barcode that's already known (see backend/src/routes/foods.ts), which
  // would silently overwrite the original food instead of creating a new one.
  prefillFood?: Food;
  onCancel: () => void;
  onCreated: (food: CreateFoodInput) => void;
}) {
  // Local, not the global preference: the in-form toggle below just changes
  // which unit the Calories field is typed/read in, so switching it here
  // doesn't silently flip the whole app's display unit off one tap.
  const { unit: globalEnergyUnit } = useEnergyUnit();
  const [energyUnit, setEnergyUnit] = useState<EnergyUnit>(globalEnergyUnit);
  const parsedPrefillMicros = prefillFood ? parseMicrosJson(prefillFood.microsJson) : {};
  const [name, setName] = useState(prefillFood?.name ?? initialName);
  const [icon, setIcon] = useState<string | null>(prefillFood?.icon ?? null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [brand, setBrand] = useState(prefillFood?.brand ?? "");
  const [servingSizeGrams, setServingSizeGrams] = useState(numToStr(prefillFood?.servingSizeGrams));
  const [calories, setCalories] = useState(() =>
    prefillFood?.caloriesPer100g == null ? "" : String(Math.round(kcalToUnit(prefillFood.caloriesPer100g, energyUnit)))
  );
  const [protein, setProtein] = useState(numToStr(prefillFood?.proteinPer100g));
  const [carbs, setCarbs] = useState(numToStr(prefillFood?.carbsPer100g));
  const [fat, setFat] = useState(numToStr(prefillFood?.fatPer100g));
  // Prefilling from an existing food likely means it already has some of
  // these set — open the disclosure by default so they're visible rather
  // than hidden behind "+ Add more nutrients" the user'd have to know to tap.
  const [showMore, setShowMore] = useState(!!prefillFood);
  const [fiber, setFiber] = useState(numToStr(prefillFood?.fiberPer100g));
  const [sugar, setSugar] = useState(numToStr(prefillFood?.sugarPer100g));
  const [sodiumMg, setSodiumMg] = useState(numToStr(prefillFood?.sodiumMgPer100g));
  const [fatSubtypes, setFatSubtypes] = useState<Record<string, string>>(
    prefillFood
      ? {
          saturatedFatPer100g: numToStr(prefillFood.saturatedFatPer100g),
          monounsaturatedFatPer100g: numToStr(prefillFood.monounsaturatedFatPer100g),
          polyunsaturatedFatPer100g: numToStr(prefillFood.polyunsaturatedFatPer100g),
          transFatPer100g: numToStr(prefillFood.transFatPer100g),
          omega3Per100g: numToStr(prefillFood.omega3Per100g),
          omega6Per100g: numToStr(prefillFood.omega6Per100g),
        }
      : {}
  );
  const [microValues, setMicroValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const group of MICRO_FIELD_GROUPS) {
      for (const f of group.fields) {
        const grams = parsedPrefillMicros[f.key];
        if (grams != null) initial[f.key] = String(displayFromGrams(f.unit, grams));
      }
    }
    return initial;
  });

  // Two separate inputs, not one bare accept="image/*" — same reasoning as
  // PhotosScreen's cameraInputRef/libraryInputRef (see that file's comment):
  // a bare file input doesn't reliably prompt "Camera or Gallery?" on
  // Android/Chrome, so PhotoSourceSheet asks explicitly and routes to
  // whichever of these two matches.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const scanLabel = useScanNutritionLabel();
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState(false);

  // Only ever overwrites fields the scan actually returned a value for (see
  // LabelScanResult — null means "couldn't read this," not zero), so a
  // partial read never clobbers something the user already typed in by hand.
  // Opens the "more nutrients" disclosure if any of those fields came back,
  // same as prefillFood does, so the scanned data isn't hidden behind a tap.
  function applyScanResult(result: LabelScanResult) {
    if (result.name != null) setName(result.name);
    if (result.brand != null) setBrand(result.brand);
    if (result.servingSizeGrams != null) setServingSizeGrams(String(result.servingSizeGrams));
    if (result.caloriesPer100g != null) setCalories(String(Math.round(kcalToUnit(result.caloriesPer100g, energyUnit))));
    if (result.proteinPer100g != null) setProtein(String(result.proteinPer100g));
    if (result.carbsPer100g != null) setCarbs(String(result.carbsPer100g));
    if (result.fatPer100g != null) setFat(String(result.fatPer100g));
    if (result.fiberPer100g != null) setFiber(String(result.fiberPer100g));
    if (result.sugarPer100g != null) setSugar(String(result.sugarPer100g));
    if (result.sodiumMgPer100g != null) setSodiumMg(String(result.sodiumMgPer100g));
    if (result.saturatedFatPer100g != null) {
      setFatSubtypes((prev) => ({ ...prev, saturatedFatPer100g: String(result.saturatedFatPer100g) }));
    }
    if (result.fiberPer100g != null || result.sugarPer100g != null || result.sodiumMgPer100g != null || result.saturatedFatPer100g != null) {
      setShowMore(true);
    }
    setScanSuccess(true);
  }

  function handleLabelPhoto(file: File) {
    setScanError(null);
    setScanSuccess(false);
    scanLabel.mutate(file, {
      onSuccess: applyScanResult,
      onError: (err) => setScanError(err instanceof Error ? err.message : "Couldn't scan that photo"),
    });
  }

  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const canSave = name.trim() !== "" && calories !== "" && protein !== "" && carbs !== "" && fat !== "";

  // Live macro-ratio preview, same "% of macro calories" pill RecipeForm's
  // per-serving card and FoodDetailScreen's summary row already use — reused
  // here so building a custom food gets the same at-a-glance sanity check
  // (do these three numbers roughly add up to the calorie count?) instead of
  // only finding out on the food's own detail screen after saving.
  const previewProtein = Number(protein) || 0;
  const previewCarbs = Number(carbs) || 0;
  const previewFat = Number(fat) || 0;
  const macroCalories = previewProtein * 4 + previewFat * 9 + previewCarbs * 4;
  const caloricRatio = (cal: number) => (macroCalories > 0 ? Math.round((cal / macroCalories) * 100) : 0);
  const showPreview = protein !== "" || carbs !== "" || fat !== "";
  // Ignores the current `icon` override so the picker's "Auto" option always
  // shows what the keyword guess would be, live as the name is typed, rather
  // than whatever's already selected (which would just echo the selection
  // back at itself).
  const autoIcon = getFoodIcon(name.trim() || "?");

  // Converts whatever's currently typed in the Calories field in place, then
  // flips this field's local unit — so switching units here doesn't
  // silently reinterpret an already-entered number in the new unit.
  function toggleEnergyUnit() {
    const next = energyUnit === "kcal" ? "kj" : "kcal";
    if (calories.trim() !== "" && !isNaN(Number(calories))) {
      const kcal = unitToKcal(Number(calories), energyUnit);
      setCalories(String(Math.round(kcalToUnit(kcal, next))));
    }
    setEnergyUnit(next);
  }

  function submit() {
    if (!canSave) return;

    const micros: Record<string, number> = {};
    for (const group of MICRO_FIELD_GROUPS) {
      for (const f of group.fields) {
        const raw = microValues[f.key];
        if (raw && raw.trim() !== "") micros[f.key] = f.toGrams(Number(raw));
      }
    }

    onCreated({
      name: name.trim(),
      icon,
      brand: brand.trim() || undefined,
      barcode,
      servingSizeGrams: num(servingSizeGrams),
      caloriesPer100g: unitToKcal(Number(calories), energyUnit),
      proteinPer100g: Number(protein),
      carbsPer100g: Number(carbs),
      fatPer100g: Number(fat),
      fiberPer100g: num(fiber),
      sugarPer100g: num(sugar),
      sodiumMgPer100g: num(sodiumMg),
      saturatedFatPer100g: num(fatSubtypes.saturatedFatPer100g ?? ""),
      monounsaturatedFatPer100g: num(fatSubtypes.monounsaturatedFatPer100g ?? ""),
      polyunsaturatedFatPer100g: num(fatSubtypes.polyunsaturatedFatPer100g ?? ""),
      transFatPer100g: num(fatSubtypes.transFatPer100g ?? ""),
      omega3Per100g: num(fatSubtypes.omega3Per100g ?? ""),
      omega6Per100g: num(fatSubtypes.omega6Per100g ?? ""),
      micros: Object.keys(micros).length > 0 ? micros : undefined,
    });
  }

  return (
    <>
      <div className="px-2.5 pt-2.5 pb-1 flex items-center gap-1 shrink-0">
        <button
          onClick={onCancel}
          aria-label="Back"
          className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-white active:bg-white/10"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <span className="text-sm font-medium">Create custom food</span>
      </div>

      {/* Enter submits via onKeyDown on each NumberField/text input (see
          NumberField's onEnter prop), not a wrapping <form> — a <form>
          element turned out to be what triggers Chrome's full autofill
          accessory strip (passwords/payment/addresses icons) on Android for
          this exact field shape (name field + several plain number fields),
          regardless of autocomplete="off". See AddFoodSheet's QuickAddTab
          for the fuller story — same fields, same fix. */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {barcode && (
          <p className="text-xs text-muted">
            No product found for barcode <span className="tabular">{barcode}</span> — this will be
            remembered for next time.
          </p>
        )}

        {/* Hidden inputs have no visible chrome of their own — the dashed
            button below is the only affordance. Two of them (camera +
            library, see cameraInputRef/libraryInputRef above), routed to by
            PhotoSourceSheet below rather than a single input clicked
            directly — `capture="environment"` on one alone opens the phone's
            back camera with no reliable way to reach the gallery instead. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) handleLabelPhoto(file);
          }}
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) handleLabelPhoto(file);
          }}
        />
        <button
          type="button"
          onClick={() => setSourcePickerOpen(true)}
          disabled={scanLabel.isPending}
          className="w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line py-3.5 text-sm font-medium text-accent active:bg-white/5 disabled:opacity-60"
        >
          {scanLabel.isPending ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Reading label…
            </>
          ) : (
            <>
              <Camera size={16} strokeWidth={2} />
              Scan nutrition label
            </>
          )}
        </button>
        {scanError && <p className="text-xs text-red-400 -mt-1">{scanError}</p>}
        {scanSuccess && !scanError && (
          <p className="text-xs text-accent -mt-1">Filled in from your photo — double-check before saving.</p>
        )}

        {/* Basics card: icon + name read as one "identity" unit (avatar
            picker beside the field it names, contact-card style), Brand
            below it. Grouped in its own bg-surface card so the bordered
            surface-raised inputs inside it sit one real step up the
            canvas/surface/surface-raised hierarchy tailwind.config.js
            defines, instead of floating directly on the page background the
            way this form used to. */}
        <div className="rounded-2xl bg-surface p-4 space-y-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setIconPickerOpen(true)}
              aria-label="Choose icon"
              className="relative shrink-0 w-14 h-14 rounded-2xl bg-surface-raised border border-line flex items-center justify-center text-3xl leading-none active:opacity-70"
            >
              {icon ?? autoIcon.value}
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-accent flex items-center justify-center ring-2 ring-surface">
                <Pencil size={10} strokeWidth={2.5} style={{ color: "#0B1210" }} />
              </span>
            </button>
            <label className="block flex-1 min-w-0">
              <span className="block text-xs text-muted mb-1">Name</span>
              <input
                type="search"
                // type="search" (not a bare type="text") is what actually
                // keeps Chrome's autofill accessory strip (passwords/
                // payment/addresses icons) away on Android — see
                // AddFoodSheet's Quick Add tab for the fuller story.
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                autoComplete="off"
                placeholder="e.g. Grilled chicken breast"
                className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
              />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs text-muted mb-1">Brand (optional)</span>
            <input
              type="search"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              autoComplete="off"
              className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
            />
          </label>
        </div>

        <div className="rounded-2xl bg-surface p-4 space-y-3">
          <p className="text-[13px] font-semibold text-white/80">Per 100 g</p>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Calories"
              value={calories}
              onChange={setCalories}
              labelClassName="text-calories"
              onEnter={submit}
              suffix={
                <button type="button" onClick={toggleEnergyUnit} className="text-xs text-accent font-medium active:opacity-70">
                  {energyUnitLabel(energyUnit)}
                </button>
              }
            />
            <NumberField label="Protein" value={protein} onChange={setProtein} suffix="g" labelClassName="text-protein" onEnter={submit} />
            <NumberField label="Carbs" value={carbs} onChange={setCarbs} suffix="g" labelClassName="text-carbs" onEnter={submit} />
            <NumberField label="Fat" value={fat} onChange={setFat} suffix="g" labelClassName="text-fat" onEnter={submit} />
          </div>

          <label className="block">
            <span className="block text-xs text-muted mb-1">Serving size (optional)</span>
            <div className="flex items-center rounded-md bg-surface-raised border border-line px-3 focus-within:border-accent">
              <input
                type="search"
                inputMode="decimal"
                autoComplete="off"
                value={servingSizeGrams}
                onChange={(e) => setServingSizeGrams(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                className="tabular w-full bg-transparent py-2.5 text-sm focus:outline-none"
              />
              <span className="text-xs text-muted">g</span>
            </div>
          </label>

          {showPreview && (
            <div className="rounded-xl bg-dashboardBg px-3 pt-3 pb-2.5">
              <div className="grid grid-cols-3 gap-2">
                {(["protein", "carbs", "fat"] as const).map((key) => {
                  const cal = key === "protein" ? previewProtein * 4 : key === "fat" ? previewFat * 9 : previewCarbs * 4;
                  const badgeClass =
                    key === "protein"
                      ? "bg-protein/15 text-protein"
                      : key === "fat"
                        ? "bg-fat/15 text-fat"
                        : "bg-carbs/15 text-carbs";
                  return (
                    <div key={key} className="text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${badgeClass}`}>
                        {caloricRatio(cal)}%
                      </span>
                      <p className="text-[10px] text-muted mt-1 capitalize">{key} of calories</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {!showMore ? (
          <button
            type="button"
            onClick={() => setShowMore(true)}
            className="w-full flex items-center justify-center gap-1.5 rounded-full bg-dashboardChip text-white text-xs font-medium py-2.5 active:bg-white/20"
          >
            + Add more nutrients (fiber, fats, vitamins, minerals…)
          </button>
        ) : (
          <div className="rounded-2xl bg-surface p-4 space-y-4">
            <div>
              <p className="text-[11px] tracking-widest uppercase text-muted pb-2">Carbs</p>
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Fiber" value={fiber} onChange={setFiber} suffix="g" onEnter={submit} />
                <NumberField label="Sugar" value={sugar} onChange={setSugar} suffix="g" onEnter={submit} />
              </div>
            </div>

            <div>
              <p className="text-[11px] tracking-widest uppercase text-muted pb-2">Fats</p>
              <div className="grid grid-cols-2 gap-3">
                {FAT_SUBTYPE_FIELDS.map((f) => (
                  <NumberField
                    key={f.key}
                    label={f.label}
                    value={fatSubtypes[f.key] ?? ""}
                    onChange={(v) => setFatSubtypes((prev) => ({ ...prev, [f.key]: v }))}
                    suffix="g"
                    onEnter={submit}
                  />
                ))}
              </div>
            </div>

            {MICRO_FIELD_GROUPS.map((group) => (
              <div key={group.category}>
                <p className="text-[11px] tracking-widest uppercase text-muted pb-2">{group.category}</p>
                <div className="grid grid-cols-2 gap-3">
                  {group.fields.map((f) => (
                    <NumberField
                      key={f.key}
                      label={f.label}
                      value={microValues[f.key] ?? ""}
                      onChange={(v) => setMicroValues((prev) => ({ ...prev, [f.key]: v }))}
                      suffix={f.unit}
                      onEnter={submit}
                    />
                  ))}
                  {group.category === "Other" && (
                    <NumberField label="Sodium" value={sodiumMg} onChange={setSodiumMg} suffix="mg" onEnter={submit} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 shrink-0">
        <button
          onClick={submit}
          disabled={!canSave}
          className="w-full py-3 rounded-md bg-accent text-base disabled:opacity-40 font-medium"
          style={{ color: "#0B1210" }}
        >
          Save food
        </button>
      </div>

      {iconPickerOpen && (
        <IconPickerModal
          value={icon}
          autoPreview={autoIcon.value}
          onSelect={setIcon}
          onClose={() => setIconPickerOpen(false)}
        />
      )}

      {sourcePickerOpen && (
        <PhotoSourceSheet
          onChooseCamera={() => cameraInputRef.current?.click()}
          onChooseLibrary={() => libraryInputRef.current?.click()}
          onClose={() => setSourcePickerOpen(false)}
        />
      )}
    </>
  );
}
