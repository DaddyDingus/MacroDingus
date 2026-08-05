import { useEffect, useState, type ReactNode } from "react";
import { useCreateFood } from "../api/foods";
import { useAddLog } from "../api/logs";
import { useEnergyUnit, kcalToUnit, unitToKcal, energyUnitLabel, type EnergyUnit } from "../lib/energyUnit";
import BottomSheet from "./BottomSheet";
import DecimalKeypad from "./DecimalKeypad";

type MacroField = "protein" | "carbs" | "fat" | "calories";

function NumberField({
  field,
  label,
  value,
  suffix,
  labelClassName,
  active,
  allSelected,
  onOpen,
}: {
  field: MacroField;
  label: string;
  value: string;
  suffix?: ReactNode;
  labelClassName?: string;
  active: boolean;
  allSelected: boolean;
  onOpen: () => void;
}) {
  return (
    <div data-quick-add-field={field} className="block">
      <span className={`block text-xs font-medium mb-1.5 ${labelClassName ?? "text-muted"}`}>{label}</span>
      <div className={`flex items-center min-h-12 rounded-xl bg-surface-raised border px-4 ${active ? "border-accent" : "border-line"}`}>
        <button
          type="button"
          onClick={onOpen}
          aria-label={label}
          aria-expanded={active}
          className="tabular min-w-0 flex-1 self-stretch bg-transparent text-base font-medium text-left flex items-center focus:outline-none"
        >
          {value ? (
            allSelected && active ? <span className="bg-accent/30 rounded px-0.5 -mx-0.5">{value}</span> : value
          ) : null}
          {active && <span className="caret-blink w-[2px] h-[1.1em] bg-white ml-1 shrink-0" />}
        </button>
        {suffix && <span className="text-sm text-muted shrink-0">{suffix}</span>}
      </div>
    </div>
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
  onLogged,
}: {
  date: string;
  onClose: () => void;
  onLogged?: () => void;
}) {
  const [name, setName] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [calories, setCalories] = useState("");
  const [activeMacro, setActiveMacro] = useState<MacroField | null>(null);
  const [allSelected, setAllSelected] = useState(false);
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

  // Opening the docked keypad reduces the form pane rather than growing the
  // whole sheet. Keep whichever macro was tapped inside that smaller pane,
  // particularly Fat/Calories on the second row.
  useEffect(() => {
    if (!activeMacro) return;
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-quick-add-field="${activeMacro}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 210);
    return () => window.clearTimeout(timer);
  }, [activeMacro]);

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

  function macroValue(field: MacroField) {
    if (field === "protein") return protein;
    if (field === "carbs") return carbs;
    if (field === "fat") return fat;
    return calories;
  }

  function setMacroValue(field: MacroField, value: string) {
    if (field === "protein") setProtein(value);
    else if (field === "carbs") setCarbs(value);
    else if (field === "fat") setFat(value);
    else setCalories(value);
  }

  function openMacro(field: MacroField) {
    if (activeMacro === field) {
      setActiveMacro(null);
      return;
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setActiveMacro(field);
    setAllSelected(Boolean(macroValue(field)));
  }

  function tapDigit(digit: string) {
    if (!activeMacro) return;
    const current = macroValue(activeMacro);
    setMacroValue(activeMacro, allSelected || current === "0" ? digit : current + digit);
    setAllSelected(false);
  }

  function tapDecimal() {
    if (!activeMacro) return;
    const current = macroValue(activeMacro);
    if (allSelected || current === "") setMacroValue(activeMacro, "0.");
    else if (!current.includes(".")) setMacroValue(activeMacro, `${current}.`);
    setAllSelected(false);
  }

  function tapBackspace() {
    if (!activeMacro) return;
    const current = macroValue(activeMacro);
    setMacroValue(activeMacro, allSelected ? "" : current.slice(0, -1));
    setAllSelected(false);
  }

  function submit() {
    if (!canSave || createFood.isPending || addLog.isPending) return;
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
          addLog.mutate(
            { food, quantityGrams: 100 },
            { onSuccess: () => (onLogged ?? onClose)() }
          );
        },
      }
    );
  }

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[88%] bg-dashboardBg rounded-t-xl border-t border-line"
    >
      {(dragHandlers) => (
        <>
      {/* No Close button — swipe-down (the grabber, or this header) or a tap
          on the backdrop dismiss the sheet, so a redundant × isn't needed. */}
      <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
        <span className="text-sm font-medium">Quick add</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-2.5">
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
            autoComplete="off"
            value={name}
            onFocus={() => setActiveMacro(null)}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="e.g. Restaurant lunch"
            className="w-full min-h-12 rounded-xl bg-surface-raised border border-line px-4 text-sm focus:outline-none focus:border-accent"
          />
        </label>

        <div className="pt-0.5">
          <p className="text-sm font-medium">Macros</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <NumberField field="protein" label="Protein" labelClassName="text-protein" value={protein} suffix="g" active={activeMacro === "protein"} allSelected={allSelected} onOpen={() => openMacro("protein")} />
          <NumberField field="carbs" label="Carbs" labelClassName="text-carbs" value={carbs} suffix="g" active={activeMacro === "carbs"} allSelected={allSelected} onOpen={() => openMacro("carbs")} />
          <NumberField field="fat" label="Fat" labelClassName="text-fat" value={fat} suffix="g" active={activeMacro === "fat"} allSelected={allSelected} onOpen={() => openMacro("fat")} />
          <NumberField
            field="calories"
            label="Calories"
            labelClassName="text-calories"
            value={calories}
            active={activeMacro === "calories"}
            allSelected={allSelected}
            onOpen={() => openMacro("calories")}
            suffix={
              <button type="button" onClick={toggleEnergyUnit} className="text-xs text-accent font-medium active:opacity-70">
                {energyUnitLabel(energyUnit)}
              </button>
            }
          />
        </div>
      </div>

      <div
        className="shrink-0 grid border-t border-dashboardDivider/60 transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: activeMacro ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pt-3 pb-2">
            <DecimalKeypad onDigit={tapDigit} onDecimal={tapDecimal} onBackspace={tapBackspace} />
          </div>
        </div>
      </div>

      <div className="p-4 pt-2 shrink-0">
        <button
          onClick={submit}
          disabled={!canSave || createFood.isPending || addLog.isPending}
          className="w-full min-h-14 rounded-xl bg-accent text-base disabled:opacity-40 font-medium"
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
