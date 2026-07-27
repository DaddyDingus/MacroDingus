import { useEffect, useState } from "react";
import { useCreateFood } from "../api/foods";
import { useAddLog } from "../api/logs";
import BottomSheet from "./BottomSheet";

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

// The fast path for "I know the numbers off a label or an app, I don't need
// a reusable food entry" — everything but the name is optional, and calories
// auto-fills from whichever macros are given (protein/carbs *4, fat *9) but
// can still be typed over directly. Materializes as a plain custom food with
// the entered totals as its per-100g values, logged at 100g (i.e. "1x") — so
// it reuses the existing food/log data model with zero backend changes.
export default function QuickAddSheet({
  date,
  onClose,
}: {
  date: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [calories, setCalories] = useState("");

  const createFood = useCreateFood();
  const addLog = useAddLog(date);

  useEffect(() => {
    if (!protein.trim() && !carbs.trim() && !fat.trim()) return;
    const p = Number(protein) || 0;
    const c = Number(carbs) || 0;
    const f = Number(fat) || 0;
    setCalories(String(Math.round(p * 4 + c * 4 + f * 9)));
  }, [protein, carbs, fat]);

  const canSave = name.trim() !== "" && calories.trim() !== "";

  function submit() {
    if (!canSave) return;
    createFood.mutate(
      {
        name: name.trim(),
        servingSizeGrams: 100,
        caloriesPer100g: Number(calories) || 0,
        proteinPer100g: Number(protein) || 0,
        carbsPer100g: Number(carbs) || 0,
        fatPer100g: Number(fat) || 0,
      },
      {
        onSuccess: (food) => {
          addLog.mutate({ food, quantityGrams: 100 });
          onClose();
        },
      }
    );
  }

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line"
    >
      <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
        <span className="text-sm font-medium">Quick add</span>
        <button onClick={onClose} className="text-muted text-xl leading-none px-1">
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        <label className="block">
          <span className="block text-xs text-muted mb-1">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Restaurant lunch"
            className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
          />
        </label>

        <p className="text-[11px] tracking-widest uppercase text-muted pt-1">
          Macros — fill in what you know, calories fill themselves in
        </p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Protein" value={protein} onChange={setProtein} suffix="g" />
          <NumberField label="Carbs" value={carbs} onChange={setCarbs} suffix="g" />
          <NumberField label="Fat" value={fat} onChange={setFat} suffix="g" />
          <NumberField label="Calories" value={calories} onChange={setCalories} suffix="kcal" />
        </div>
      </div>

      <div className="p-4 shrink-0">
        <button
          onClick={submit}
          disabled={!canSave || createFood.isPending}
          className="w-full py-3 rounded-md bg-accent text-base disabled:opacity-40 font-medium"
          style={{ color: "#0B1210" }}
        >
          Add
        </button>
      </div>
    </BottomSheet>
  );
}
