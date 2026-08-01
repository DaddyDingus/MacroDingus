import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Lock, Unlock } from "lucide-react";
import { useCoachStatus } from "../api/coach";
import { usePrograms, useUpdateProgramDays, useRegenerateProgram, type Program } from "../api/programs";
import WeeklyProgramGrid from "../components/WeeklyProgramGrid";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday-first, matches WeeklyProgramGrid

interface DayEdit {
  targetCalories: number;
  proteinPerKg: number;
  carbFatRatioPct: number; // 0-100, share of post-protein calories that goes to carbs
}

function deriveEdit(day: Program["days"][number], trendWeightKg: number): DayEdit {
  const proteinPerKg = trendWeightKg > 0 ? day.targetProteinG / trendWeightKg : 0;
  const carbKcal = day.targetCarbsG * 4;
  const fatKcal = day.targetFatG * 9;
  const total = carbKcal + fatKcal;
  const carbFatRatioPct = total > 0 ? Math.round((carbKcal / total) * 100) : 50;
  return { targetCalories: day.targetCalories, proteinPerKg, carbFatRatioPct };
}

function resolveMacros(edit: DayEdit, trendWeightKg: number) {
  const proteinG = edit.proteinPerKg * trendWeightKg;
  const proteinKcal = proteinG * 4;
  const remainingKcal = Math.max(0, edit.targetCalories - proteinKcal);
  const carbKcal = remainingKcal * (edit.carbFatRatioPct / 100);
  const fatKcal = remainingKcal - carbKcal;
  return {
    targetCalories: Math.round(edit.targetCalories),
    targetProteinG: Math.round(proteinG * 10) / 10,
    targetCarbsG: Math.round((carbKcal / 4) * 10) / 10,
    targetFatG: Math.round((fatKcal / 9) * 10) / 10,
  };
}

export default function EditProgramScreen() {
  const navigate = useNavigate();
  const status = useCoachStatus();
  const programs = usePrograms();
  const updateDays = useUpdateProgramDays();
  const regenerate = useRegenerateProgram();

  const activeProgram = status.data?.activeProgram ?? null;
  const trendWeightKg = status.data?.trendWeightKg ?? null;

  const [selectedDay, setSelectedDay] = useState(1); // Monday
  const [edits, setEdits] = useState<Record<number, DayEdit> | null>(null);
  const [lockedDays, setLockedDays] = useState<Set<number>>(new Set());
  // Days the user has directly changed (calories or macros) — distinct from
  // lockedDays (a manual "freeze this day's inputs" toggle): editedDays is
  // set automatically and only ever affects which days are eligible to
  // absorb calorie redistribution from an edit elsewhere, never whether
  // this day itself can still be edited.
  const [editedDays, setEditedDays] = useState<Set<number>>(new Set());
  const [caloriesInputMode, setCaloriesInputMode] = useState<"slider" | "type">("type");

  useEffect(() => {
    if (activeProgram && trendWeightKg !== null && !edits) {
      const next: Record<number, DayEdit> = {};
      for (const d of activeProgram.days) next[d.dayOfWeek] = deriveEdit(d, trendWeightKg);
      setEdits(next);
    }
    // Only seed once, on first load — not every time activeProgram refetches,
    // or in-progress slider edits would keep getting clobbered by the
    // server's last-saved values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProgram, trendWeightKg]);

  if (status.isLoading || programs.isLoading || !activeProgram || trendWeightKg === null || !edits) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-sm text-muted">{activeProgram ? "Loading…" : "No active program to edit."}</p>
      </div>
    );
  }

  // Rebound to freshly-narrowed consts — TS's control-flow narrowing from
  // the guard above doesn't carry into the function declarations below.
  const program = activeProgram;
  const weightKg = trendWeightKg;

  const previewDays = DISPLAY_ORDER.map((dow) => {
    const edit = edits[dow];
    const macros = edit ? resolveMacros(edit, weightKg) : { targetCalories: 0, targetProteinG: 0, targetCarbsG: 0, targetFatG: 0 };
    return { dayOfWeek: dow, calories: macros.targetCalories, proteinG: macros.targetProteinG, carbsG: macros.targetCarbsG, fatG: macros.targetFatG };
  });

  const current = edits[selectedDay];
  const currentMacros = resolveMacros(current, weightKg);
  const isLocked = lockedDays.has(selectedDay);
  const maxCalories = Math.round(weightKg * 40); // generous ceiling, just to bound the input

  function updateCurrent(patch: Partial<DayEdit>) {
    if (isLocked) return;

    setEditedDays((prev) => (prev.has(selectedDay) ? prev : new Set(prev).add(selectedDay)));

    if (patch.targetCalories === undefined) {
      setEdits((prev) => (prev ? { ...prev, [selectedDay]: { ...prev[selectedDay], ...patch } } : prev));
      return;
    }

    const newCalories = Math.max(0, Math.min(maxCalories, patch.targetCalories));
    const delta = newCalories - current.targetCalories;

    // Days eligible to absorb the compensating change: not the day being
    // edited, not manually frozen (lockedDays), and not already customized
    // by an earlier edit this session (editedDays) — matches "once a day
    // has been touched, later edits leave it alone."
    const protectedDays = new Set([...lockedDays, ...editedDays, selectedDay]);
    const compensable = DISPLAY_ORDER.filter((d) => !protectedDays.has(d));
    const perDay = compensable.length > 0 ? -delta / compensable.length : 0;

    setEdits((prev) => {
      if (!prev) return prev;
      const next: Record<number, DayEdit> = { ...prev, [selectedDay]: { ...prev[selectedDay], targetCalories: newCalories } };
      // Even split, floor-clamped per day at 0 — same tradeoff documented on
      // distributeShiftedWeek in engine/program.ts: never push a day below
      // 0, even if that means the weekly total drifts slightly rather than
      // balancing exactly. Ratios (proteinPerKg/carbFatRatioPct) are left
      // untouched on compensated days, so their macros keep following
      // whatever split they already had — the plan's own ratios, for any
      // day that hasn't been individually customized.
      for (const d of compensable) {
        next[d] = { ...prev[d], targetCalories: Math.max(0, prev[d].targetCalories + perDay) };
      }
      return next;
    });
  }

  function handleDone() {
    if (!edits) return;
    const days = Object.entries(edits).map(([dow, edit]) => ({ dayOfWeek: Number(dow), ...resolveMacros(edit, weightKg) }));
    updateDays.mutate({ id: program.id, days }, { onSuccess: () => navigate("/strategy") });
  }

  function handleResetAll() {
    if (program.style !== "coached") return;
    regenerate.mutate(program.id, {
      onSuccess: (data) => {
        const next: Record<number, DayEdit> = {};
        for (const d of data.program.days) next[d.dayOfWeek] = deriveEdit(d, weightKg);
        setEdits(next);
        setLockedDays(new Set());
        setEditedDays(new Set());
      },
    });
  }

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3 flex items-center gap-3">
        <button onClick={() => navigate("/strategy")} aria-label="Back" className="p-1 -ml-1">
          <ChevronLeft className="w-5 h-5" strokeWidth={2} />
        </button>
        <h1 className="text-base font-medium flex-1 text-center pr-6">Edit Program</h1>
      </header>

      <main className="px-4 space-y-4 max-w-md mx-auto">
        <WeeklyProgramGrid days={previewDays} unit="kcal" />

        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {DISPLAY_ORDER.map((dow) => (
            <button
              key={dow}
              onClick={() => setSelectedDay(dow)}
              aria-label={lockedDays.has(dow) || editedDays.has(dow) ? `${DAY_LABELS[dow]} (won't be auto-adjusted)` : DAY_LABELS[dow]}
              className={`relative w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
                selectedDay === dow ? "bg-ink" : "bg-surface-raised text-muted"
              }`}
              style={selectedDay === dow ? { color: "#0B1210" } : undefined}
            >
              {DAY_SHORT[dow]}
              {(lockedDays.has(dow) || editedDays.has(dow)) && (
                // Kept inside the button's own box (no negative offset) —
                // the row's overflow-x-auto implicitly clips overflow-y too
                // (mixing visible-y with a non-visible x forces y to "auto"
                // per the CSS spec), so anything poking past the button edge
                // via a negative position gets cut off at the top.
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-accent" />
              )}
            </button>
          ))}
        </div>

        <div key={selectedDay} className="step-enter space-y-4">
        <div className="flex items-center justify-between pt-1">
          <h2 className="text-lg font-semibold">{DAY_LABELS[selectedDay]}</h2>
          <div className="flex items-center gap-2">
            {activeProgram.style === "coached" && (
              <button
                onClick={handleResetAll}
                disabled={regenerate.isPending}
                className="text-xs px-3 py-1.5 rounded-full border border-line text-muted disabled:opacity-50"
              >
                {regenerate.isPending ? "Resetting…" : "Reset All Days"}
              </button>
            )}
            <button
              onClick={() => setLockedDays((prev) => { const next = new Set(prev); next.has(selectedDay) ? next.delete(selectedDay) : next.add(selectedDay); return next; })}
              aria-label={isLocked ? "Unlock this day" : "Lock this day"}
              className="w-8 h-8 rounded-full bg-surface-raised flex items-center justify-center"
            >
              {isLocked ? <Lock className="w-3.5 h-3.5" strokeWidth={2} /> : <Unlock className="w-3.5 h-3.5 text-muted" strokeWidth={2} />}
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Calories</p>
            <div className="flex rounded-full border border-line overflow-hidden text-[11px] shrink-0">
              <button
                type="button"
                onClick={() => setCaloriesInputMode("slider")}
                className={`px-2.5 py-1 ${caloriesInputMode === "slider" ? "bg-accent" : "text-muted"}`}
                style={caloriesInputMode === "slider" ? { color: "#0B1210" } : undefined}
              >
                Slider
              </button>
              <button
                type="button"
                onClick={() => setCaloriesInputMode("type")}
                className={`px-2.5 py-1 ${caloriesInputMode === "type" ? "bg-accent" : "text-muted"}`}
                style={caloriesInputMode === "type" ? { color: "#0B1210" } : undefined}
              >
                Type
              </button>
            </div>
          </div>
          {caloriesInputMode === "slider" ? (
            <input
              type="range"
              min={0}
              max={maxCalories}
              step={10}
              value={Math.round(current.targetCalories)}
              disabled={isLocked}
              onChange={(e) => updateCurrent({ targetCalories: Number(e.target.value) })}
              className="w-full accent-ink"
            />
          ) : (
            <input
              type="number"
              inputMode="decimal"
              autoComplete="off"
              value={Math.round(current.targetCalories)}
              disabled={isLocked}
              onChange={(e) => updateCurrent({ targetCalories: Number(e.target.value) || 0 })}
              className="w-full border border-line rounded-md px-4 py-3 bg-transparent tabular focus:outline-none focus:border-accent disabled:opacity-50"
            />
          )}
          <p className="text-xs text-muted mt-1">
            {Math.round(current.targetCalories).toLocaleString()} kcal today · set between 0 and {maxCalories.toLocaleString()} kcal.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Protein</p>
            <p className="tabular text-sm">{current.proteinPerKg.toFixed(2)} g/kg</p>
          </div>
          <input
            type="range"
            min={0}
            max={4}
            step={0.05}
            value={current.proteinPerKg}
            disabled={isLocked}
            onChange={(e) => updateCurrent({ proteinPerKg: Number(e.target.value) })}
            className="w-full accent-protein"
          />
          <p className="text-xs text-muted mt-1">{currentMacros.targetProteinG} g today · set between 0 and 4.0 g per kg of body weight.</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Carb to Fat Ratio</p>
            <p className="tabular text-sm">{current.carbFatRatioPct}%</p>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={current.carbFatRatioPct}
            disabled={isLocked}
            onChange={(e) => updateCurrent({ carbFatRatioPct: Number(e.target.value) })}
            className="w-full accent-carbs"
          />
          <p className="text-xs text-muted mt-1">
            {currentMacros.targetCarbsG} g carbs · {currentMacros.targetFatG} g fat — set carbs as a share of remaining calories after protein.
          </p>
        </div>

        <button
          onClick={handleDone}
          disabled={updateDays.isPending}
          className="w-full py-3.5 rounded-full text-sm font-semibold disabled:opacity-50"
          style={{ background: "#ECEDEE", color: "#0B1210" }}
        >
          {updateDays.isPending ? "Saving…" : "Done"}
        </button>
        </div>
      </main>
    </div>
  );
}
