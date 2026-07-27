import { useState } from "react";
import type { CreateFoodInput } from "../api/types";

function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-muted mb-1">{label}</span>
      <div className="flex items-center rounded-md bg-surface-raised border border-line px-3 focus-within:border-accent">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
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

export default function CreateFoodForm({
  initialName,
  barcode,
  onCancel,
  onCreated,
}: {
  initialName: string;
  barcode?: string;
  onCancel: () => void;
  onCreated: (food: CreateFoodInput) => void;
}) {
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState("");
  const [servingSizeGrams, setServingSizeGrams] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [fiber, setFiber] = useState("");
  const [sugar, setSugar] = useState("");
  const [sodiumMg, setSodiumMg] = useState("");
  const [fatSubtypes, setFatSubtypes] = useState<Record<string, string>>({});
  const [microValues, setMicroValues] = useState<Record<string, string>>({});

  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const canSave = name.trim() !== "" && calories !== "" && protein !== "" && carbs !== "" && fat !== "";

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
      brand: brand.trim() || undefined,
      barcode,
      servingSizeGrams: num(servingSizeGrams),
      caloriesPer100g: Number(calories),
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
      <div className="px-4 pt-4 pb-2 flex items-center gap-3 shrink-0">
        <button onClick={onCancel} className="text-muted text-lg leading-none px-1">
          ‹
        </button>
        <span className="text-sm font-medium">Create custom food</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {barcode && (
          <p className="text-xs text-muted">
            No product found for barcode <span className="tabular">{barcode}</span> — this will be
            remembered for next time.
          </p>
        )}
        <label className="block">
          <span className="block text-xs text-muted mb-1">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Grilled chicken breast"
            className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-muted mb-1">Brand (optional)</span>
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
          />
        </label>

        <p className="text-[11px] tracking-widest uppercase text-muted pt-1">Per 100 g</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Calories" value={calories} onChange={setCalories} suffix="kcal" />
          <NumberField label="Protein" value={protein} onChange={setProtein} suffix="g" />
          <NumberField label="Carbs" value={carbs} onChange={setCarbs} suffix="g" />
          <NumberField label="Fat" value={fat} onChange={setFat} suffix="g" />
        </div>

        <label className="block pt-1">
          <span className="block text-xs text-muted mb-1">Serving size (optional)</span>
          <div className="flex items-center rounded-md bg-surface-raised border border-line px-3 focus-within:border-accent">
            <input
              type="number"
              inputMode="decimal"
              value={servingSizeGrams}
              onChange={(e) => setServingSizeGrams(e.target.value)}
              className="tabular w-full bg-transparent py-2.5 text-sm focus:outline-none"
            />
            <span className="text-xs text-muted">g</span>
          </div>
        </label>

        {!showMore ? (
          <button onClick={() => setShowMore(true)} className="text-sm text-accent pt-1">
            + Add more nutrients (fiber, fats, vitamins, minerals…)
          </button>
        ) : (
          <div className="space-y-4 pt-1">
            <div>
              <p className="text-[11px] tracking-widest uppercase text-muted pb-2">Carbs</p>
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Fiber" value={fiber} onChange={setFiber} suffix="g" />
                <NumberField label="Sugar" value={sugar} onChange={setSugar} suffix="g" />
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
                    />
                  ))}
                  {group.category === "Other" && <NumberField label="Sodium" value={sodiumMg} onChange={setSodiumMg} suffix="mg" />}
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
    </>
  );
}
