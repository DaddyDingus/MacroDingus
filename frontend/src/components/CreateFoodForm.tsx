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
      <div className="flex items-center rounded-md bg-surface-raised border border-line px-3">
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
  const [saturatedFat, setSaturatedFat] = useState("");
  const [sodiumMg, setSodiumMg] = useState("");

  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const canSave = name.trim() !== "" && calories !== "" && protein !== "" && carbs !== "" && fat !== "";

  function submit() {
    if (!canSave) return;
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
      saturatedFatPer100g: num(saturatedFat),
      sodiumMgPer100g: num(sodiumMg),
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
          <div className="flex items-center rounded-md bg-surface-raised border border-line px-3">
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
            + Add fiber, sugar, sodium…
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <NumberField label="Fiber" value={fiber} onChange={setFiber} suffix="g" />
            <NumberField label="Sugar" value={sugar} onChange={setSugar} suffix="g" />
            <NumberField label="Sat. fat" value={saturatedFat} onChange={setSaturatedFat} suffix="g" />
            <NumberField label="Sodium" value={sodiumMg} onChange={setSodiumMg} suffix="mg" />
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
