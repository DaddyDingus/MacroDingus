import { useEffect, useState, type ReactNode } from "react";
import { useCreateFood } from "../api/foods";
import { useAddLog } from "../api/logs";
import { useEnergyUnit, kcalToUnit, unitToKcal, energyUnitLabel, type EnergyUnit } from "../lib/energyUnit";
import BottomSheet from "./BottomSheet";

function NumberField({
  label,
  value,
  onChange,
  suffix,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: ReactNode;
  onEnter?: () => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-muted mb-1">{label}</span>
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
  // Local, not the global preference: this toggle just changes which unit
  // this one field is typed/read in, mirroring CreateFoodForm's toggle. It
  // used to call the shared setUnit and so silently flipped the whole app's
  // display unit (Dashboard, food details, everywhere) off one tap here.
  const { unit: globalEnergyUnit } = useEnergyUnit();
  const [energyUnit, setEnergyUnit] = useState<EnergyUnit>(globalEnergyUnit);

  const createFood = useCreateFood();
  const addLog = useAddLog(date);

  useEffect(() => {
    if (!protein.trim() && !carbs.trim() && !fat.trim()) return;
    const p = Number(protein) || 0;
    const c = Number(carbs) || 0;
    const f = Number(fat) || 0;
    setCalories(String(Math.round(kcalToUnit(p * 4 + c * 4 + f * 9, energyUnit))));
  }, [protein, carbs, fat, energyUnit]);

  const canSave = name.trim() !== "" && calories.trim() !== "";

  // Same in-place conversion pattern as CreateFoodForm's toggle — whatever's
  // currently shown (typed directly or auto-filled from macros) converts to
  // the new unit before this field's local unit actually flips.
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
    createFood.mutate(
      {
        name: name.trim(),
        servingSizeGrams: 100,
        caloriesPer100g: unitToKcal(Number(calories) || 0, energyUnit),
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
      {(dragHandlers) => (
        <>
      {/* No Close button — swipe-down (the grabber, or this header) or a tap
          on the backdrop dismiss the sheet, so a redundant × isn't needed. */}
      <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
        <span className="text-sm font-medium">Quick add</span>
      </div>

      {/* Enter submits via onKeyDown on each field, not a wrapping <form> —
          a <form> element turned out to be what triggers Chrome's full
          autofill accessory strip (passwords/payment/addresses icons) on
          Android, regardless of autocomplete="off" or a distinct name
          attribute on the fields inside it. See AddFoodSheet's own Quick Add
          tab for the fuller story — same fields, same fix. */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        <label className="block">
          <span className="block text-xs text-muted mb-1">Name</span>
          <input
            type="search"
            // Removing the <form> wasn't enough on its own — turns out
            // type="search" (which the app's other search boxes already use
            // and never triggered this) is the more reliable signal to
            // Chromium's Android autofill integration than autocomplete/name
            // ever were on a bare type="text" field. See AddFoodSheet's own
            // Quick Add tab for the fuller story.
            autoFocus
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="e.g. Restaurant lunch"
            className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
          />
        </label>

        <p className="text-[11px] tracking-widest uppercase text-muted pt-1">
          Macros — fill in what you know, calories fill themselves in
        </p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Protein" value={protein} onChange={setProtein} suffix="g" onEnter={submit} />
          <NumberField label="Carbs" value={carbs} onChange={setCarbs} suffix="g" onEnter={submit} />
          <NumberField label="Fat" value={fat} onChange={setFat} suffix="g" onEnter={submit} />
          <NumberField
            label="Calories"
            value={calories}
            onChange={setCalories}
            onEnter={submit}
            suffix={
              <button type="button" onClick={toggleEnergyUnit} className="text-xs text-accent font-medium active:opacity-70">
                {energyUnitLabel(energyUnit)}
              </button>
            }
          />
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
        </>
      )}
    </BottomSheet>
  );
}
