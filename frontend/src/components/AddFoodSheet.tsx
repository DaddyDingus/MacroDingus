import { useEffect, useState } from "react";
import type { Food, LogEntry, Meal } from "../api/types";
import { useFoodSearch, useCreateFood } from "../api/foods";
import { useAddLog, useUpdateLogQuantity, useDeleteLog, useSmartHistory } from "../api/logs";
import { scaleNutrition } from "../lib/nutrition";
import { localTimeString } from "../lib/date";
import CreateFoodForm from "./CreateFoodForm";

const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snacks: "Snacks",
};

type Step = "search" | "quantity" | "create";

export default function AddFoodSheet({
  open,
  meal,
  date,
  editingEntry,
  onClose,
}: {
  open: boolean;
  meal: Meal | null;
  date: string;
  editingEntry: LogEntry | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [grams, setGrams] = useState(100);

  const activeMeal = editingEntry?.meal ?? meal;

  useEffect(() => {
    if (!open) return;
    if (editingEntry) {
      setSelectedFood(editingEntry.food);
      setGrams(editingEntry.quantityGrams);
      setStep("quantity");
    } else {
      setSelectedFood(null);
      setGrams(100);
      setStep("search");
    }
    setQuery("");
  }, [open, editingEntry]);

  const search = useFoodSearch(query);
  const smartHistory = useSmartHistory(localTimeString());
  const addLog = useAddLog(date);
  const updateLog = useUpdateLogQuantity(date);
  const deleteLog = useDeleteLog(date);
  const createFood = useCreateFood();

  if (!open || !activeMeal) return null;

  function pickFood(food: Food) {
    setSelectedFood(food);
    setGrams(food.servingSizeGrams ?? 100);
    setStep("quantity");
  }

  function confirmQuantity() {
    if (!selectedFood || !activeMeal) return;
    if (editingEntry) {
      updateLog.mutate({ id: editingEntry.id, quantityGrams: grams });
    } else {
      addLog.mutate({ food: selectedFood, meal: activeMeal, quantityGrams: grams });
    }
    onClose();
  }

  function removeEntry() {
    if (!editingEntry) return;
    deleteLog.mutate(editingEntry.id);
    onClose();
  }

  const suggestions = query.trim() ? search.data : smartHistory.data?.foods;
  const suggestionsLabel = query.trim()
    ? "Results"
    : smartHistory.data?.basis === "time-of-day"
      ? "Usually around now"
      : "Recently logged";

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] flex flex-col bg-surface rounded-t-xl border-t border-line">
        {step === "search" && (
          <>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
              <span className="text-sm font-medium">Add to {MEAL_LABELS[activeMeal]}</span>
              <button onClick={onClose} className="text-muted text-xl leading-none px-1">
                ×
              </button>
            </div>
            <div className="px-4 pb-3 shrink-0">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search foods…"
                className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex-1 overflow-y-auto pb-4">
              <p className="px-4 pb-1 text-[11px] tracking-widest uppercase text-muted">
                {suggestionsLabel}
              </p>
              {suggestions?.length === 0 && (
                <p className="px-4 py-3 text-sm text-muted">No foods found.</p>
              )}
              {suggestions?.map((food) => (
                <button
                  key={food.id}
                  onClick={() => pickFood(food)}
                  className="w-full flex items-center justify-between px-4 py-2.5 border-b border-line/60 text-left active:bg-surface-raised"
                >
                  <span className="min-w-0">
                    <span className="block text-sm truncate">{food.name}</span>
                    {food.brand && <span className="block text-xs text-muted truncate">{food.brand}</span>}
                  </span>
                  <span className="tabular text-xs text-muted shrink-0 ml-3">
                    {Math.round(food.caloriesPer100g)} kcal/100g
                  </span>
                </button>
              ))}
              <button
                onClick={() => setStep("create")}
                className="w-full px-4 py-3 text-sm text-accent text-left"
              >
                + Create custom food{query.trim() ? ` "${query.trim()}"` : ""}
              </button>
            </div>
          </>
        )}

        {step === "quantity" && selectedFood && (
          <QuantityStep
            food={selectedFood}
            grams={grams}
            setGrams={setGrams}
            meal={activeMeal}
            isEditing={!!editingEntry}
            onBack={() => (editingEntry ? onClose() : setStep("search"))}
            onConfirm={confirmQuantity}
            onRemove={editingEntry ? removeEntry : undefined}
          />
        )}

        {step === "create" && (
          <CreateFoodForm
            initialName={query.trim()}
            onCancel={() => setStep("search")}
            onCreated={(food) => {
              createFood.mutate(food, {
                onSuccess: (created) => pickFood(created),
              });
            }}
          />
        )}
      </div>
    </div>
  );
}

function QuantityStep({
  food,
  grams,
  setGrams,
  meal,
  isEditing,
  onBack,
  onConfirm,
  onRemove,
}: {
  food: Food;
  grams: number;
  setGrams: (g: number) => void;
  meal: Meal;
  isEditing: boolean;
  onBack: () => void;
  onConfirm: () => void;
  onRemove?: () => void;
}) {
  const nutrition = scaleNutrition(food, grams);
  const chips = [
    food.servingSizeGrams && { label: `1 serving (${food.servingSizeGrams}g)`, value: food.servingSizeGrams },
    { label: "50 g", value: 50 },
    { label: "100 g", value: 100 },
    { label: "150 g", value: 150 },
  ].filter(Boolean) as { label: string; value: number }[];

  return (
    <>
      <div className="px-4 pt-4 pb-2 flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="text-muted text-lg leading-none px-1">
          ‹
        </button>
        <span className="text-sm font-medium truncate">{food.name}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-2">
        <div className="flex items-center justify-center gap-4 py-4">
          <button
            onClick={() => setGrams(Math.max(1, grams - 10))}
            className="h-10 w-10 rounded-full border border-line text-lg active:bg-surface-raised"
          >
            −
          </button>
          <div className="flex items-baseline gap-1">
            <input
              type="number"
              inputMode="decimal"
              value={grams}
              onChange={(e) => setGrams(Math.max(0, Number(e.target.value) || 0))}
              className="tabular w-24 bg-transparent text-3xl text-center focus:outline-none"
            />
            <span className="text-sm text-muted">g</span>
          </div>
          <button
            onClick={() => setGrams(grams + 10)}
            className="h-10 w-10 rounded-full border border-line text-lg active:bg-surface-raised"
          >
            +
          </button>
        </div>

        <div className="flex flex-wrap gap-2 justify-center pb-4">
          {chips.map((chip) => (
            <button
              key={chip.label}
              onClick={() => setGrams(chip.value)}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                grams === chip.value ? "border-accent text-accent" : "border-line text-muted"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="border border-line rounded-md px-4 py-3 grid grid-cols-4 gap-2 text-center">
          <div>
            <div className="tabular text-sm">{Math.round(nutrition.calories)}</div>
            <div className="text-[11px] text-muted">kcal</div>
          </div>
          <div>
            <div className="tabular text-sm text-protein">{nutrition.protein.toFixed(1)}</div>
            <div className="text-[11px] text-muted">protein</div>
          </div>
          <div>
            <div className="tabular text-sm text-carbs">{nutrition.carbs.toFixed(1)}</div>
            <div className="text-[11px] text-muted">carbs</div>
          </div>
          <div>
            <div className="tabular text-sm text-fat">{nutrition.fat.toFixed(1)}</div>
            <div className="text-[11px] text-muted">fat</div>
          </div>
        </div>
      </div>

      <div className="p-4 shrink-0 flex gap-2">
        {onRemove && (
          <button
            onClick={onRemove}
            className="px-4 py-3 rounded-md border border-line text-sm text-muted"
          >
            Remove
          </button>
        )}
        <button
          onClick={onConfirm}
          disabled={grams <= 0}
          className="flex-1 py-3 rounded-md bg-accent text-base disabled:opacity-40 font-medium"
          style={{ color: "#0B1210" }}
        >
          {isEditing ? "Save" : `Add to ${MEAL_LABELS[meal]}`}
        </button>
      </div>
    </>
  );
}
