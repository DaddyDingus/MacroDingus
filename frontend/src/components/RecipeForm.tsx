import { useState } from "react";
import type { Food } from "../api/types";
import { useFoodSearch } from "../api/foods";
import { scaleNutrition, sumNutrition } from "../lib/nutrition";

interface Ingredient {
  food: Food;
  quantityGrams: number;
}

export interface RecipeFormInitial {
  name: string;
  servings: number;
  totalWeightGrams: number;
  ingredients: Ingredient[];
}

export default function RecipeForm({
  initialName,
  initial,
  onCancel,
  onCreated,
}: {
  initialName: string;
  initial?: RecipeFormInitial;
  onCancel: () => void;
  onCreated: (input: { name: string; servings: number; totalWeightGrams?: number; ingredients: Ingredient[] }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? initialName);
  const [ingredients, setIngredients] = useState<Ingredient[]>(initial?.ingredients ?? []);
  const [servings, setServings] = useState(String(initial?.servings ?? 4));
  const [weightOverride, setWeightOverride] = useState(
    initial && initial.totalWeightGrams !== initial.ingredients.reduce((s, i) => s + i.quantityGrams, 0)
      ? String(initial.totalWeightGrams)
      : ""
  );
  const [ingredientQuery, setIngredientQuery] = useState("");

  const search = useFoodSearch(ingredientQuery);

  const ingredientSumGrams = ingredients.reduce((sum, i) => sum + i.quantityGrams, 0);
  const totalWeightGrams = weightOverride.trim() ? Number(weightOverride) : ingredientSumGrams;
  const totals = sumNutrition(ingredients.map((i) => scaleNutrition(i.food, i.quantityGrams)));
  const servingsNum = Number(servings) || 0;
  const perServing =
    servingsNum > 0
      ? {
          calories: totals.calories / servingsNum,
          protein: totals.protein / servingsNum,
          carbs: totals.carbs / servingsNum,
          fat: totals.fat / servingsNum,
        }
      : null;

  const canSave = name.trim() !== "" && ingredients.length > 0 && servingsNum > 0 && totalWeightGrams > 0;

  function addIngredient(food: Food) {
    setIngredients((prev) => [...prev, { food, quantityGrams: food.servingSizeGrams ?? 100 }]);
    setIngredientQuery("");
  }

  function updateQuantity(index: number, quantityGrams: number) {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, quantityGrams } : ing)));
  }

  function removeIngredient(index: number) {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  }

  function submit() {
    if (!canSave) return;
    onCreated({
      name: name.trim(),
      servings: servingsNum,
      totalWeightGrams: weightOverride.trim() ? Number(weightOverride) : undefined,
      ingredients,
    });
  }

  return (
    <>
      <div className="px-4 pt-4 pb-2 flex items-center gap-3 shrink-0">
        <button onClick={onCancel} className="text-muted text-lg leading-none px-1">
          ‹
        </button>
        <span className="text-sm font-medium">{initial ? "Edit recipe" : "Create recipe"}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        <label className="block">
          <span className="block text-xs text-muted mb-1">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Chicken stir fry"
            className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
          />
        </label>

        <div>
          <span className="block text-xs text-muted mb-1">Ingredients</span>
          <input
            value={ingredientQuery}
            onChange={(e) => setIngredientQuery(e.target.value)}
            placeholder="Search foods to add…"
            className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
          />
          {ingredientQuery.trim() && (
            <div className="mt-1 border border-line rounded-md overflow-hidden max-h-40 overflow-y-auto">
              {search.data?.length === 0 && <p className="px-3 py-2 text-xs text-muted">No foods found.</p>}
              {search.data?.map((food) => (
                <button
                  key={food.id}
                  onClick={() => addIngredient(food)}
                  className="w-full flex items-center justify-between px-3 py-2 border-b border-line/60 last:border-b-0 text-left active:bg-surface-raised"
                >
                  <span className="text-sm truncate">{food.name}</span>
                  <span className="tabular text-xs text-muted shrink-0 ml-2">
                    {Math.round(food.caloriesPer100g)} kcal/100g
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {ingredients.length > 0 && (
          <div className="border border-line rounded-md overflow-hidden">
            {ingredients.map((ing, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2 border-b border-line/60 last:border-b-0"
              >
                <span className="text-sm truncate min-w-0 flex-1">{ing.food.name}</span>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={ing.quantityGrams}
                    onChange={(e) => updateQuantity(i, Math.max(0, Number(e.target.value) || 0))}
                    className="tabular w-16 bg-surface-raised border border-line rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-accent"
                  />
                  <span className="text-xs text-muted">g</span>
                  <button
                    onClick={() => removeIngredient(i)}
                    aria-label={`Remove ${ing.food.name}`}
                    className="text-muted text-base leading-none px-1.5"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 pt-1">
          <label className="block">
            <span className="block text-xs text-muted mb-1">Servings</span>
            <input
              type="number"
              inputMode="decimal"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              className="tabular w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="block text-xs text-muted mb-1">
              Total weight {!weightOverride.trim() && ingredientSumGrams > 0 && (
                <span className="tabular">({Math.round(ingredientSumGrams)}g)</span>
              )}
            </span>
            <div className="flex items-center rounded-md bg-surface-raised border border-line px-3 focus-within:border-accent">
              <input
                type="number"
                inputMode="decimal"
                value={weightOverride}
                onChange={(e) => setWeightOverride(e.target.value)}
                placeholder={String(Math.round(ingredientSumGrams))}
                className="tabular w-full bg-transparent py-2.5 text-sm focus:outline-none"
              />
              <span className="text-xs text-muted">g</span>
            </div>
          </label>
        </div>
        <p className="text-xs text-muted -mt-2">
          Only override the weight if cooking changed it (water lost or absorbed) — calories don't change, but
          nutrition per gram does.
        </p>

        {perServing && (
          <div className="border border-line rounded-md px-4 py-3 grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="tabular text-sm">{Math.round(perServing.calories)}</div>
              <div className="text-[11px] text-muted">kcal</div>
            </div>
            <div>
              <div className="tabular text-sm text-protein">{perServing.protein.toFixed(1)}</div>
              <div className="text-[11px] text-muted">protein</div>
            </div>
            <div>
              <div className="tabular text-sm text-carbs">{perServing.carbs.toFixed(1)}</div>
              <div className="text-[11px] text-muted">carbs</div>
            </div>
            <div>
              <div className="tabular text-sm text-fat">{perServing.fat.toFixed(1)}</div>
              <div className="text-[11px] text-muted">fat</div>
            </div>
            <div className="col-span-4 text-[11px] text-muted pt-1">per serving</div>
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
          {initial ? "Save changes" : "Save recipe"}
        </button>
      </div>
    </>
  );
}
