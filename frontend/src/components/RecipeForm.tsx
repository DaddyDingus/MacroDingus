import { useState } from "react";
import { ChevronLeft, Pencil, X } from "lucide-react";
import type { Food } from "../api/types";
import { useFoodSearch } from "../api/foods";
import { scaleNutrition, sumNutrition } from "../lib/nutrition";
import FoodIconAvatar from "./FoodIconAvatar";
import IconPickerModal from "./IconPickerModal";
import { getFoodIcon } from "../lib/foodEmoji";
import type { SheetDragHandlers } from "./BottomSheet";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";

interface Ingredient {
  food: Food;
  quantityGrams: number;
}

export interface RecipeFormInitial {
  name: string;
  icon?: string | null;
  servings: number;
  totalWeightGrams: number;
  ingredients: Ingredient[];
}

export default function RecipeForm({
  initialName,
  initial,
  onCancel,
  onCreated,
  dragHandlers,
}: {
  initialName: string;
  initial?: RecipeFormInitial;
  onCancel: () => void;
  onCreated: (input: { name: string; icon: string | null; servings: number; totalWeightGrams?: number; ingredients: Ingredient[] }) => void;
  // Spread onto this form's own header (below) when it's rendered directly
  // as a BottomSheet's child (RecipeEditSheet, CreateRecipeFromGroupSheet,
  // QuickActionFlow's "newRecipe" step) — lets that header double as the
  // sheet's drag-to-dismiss surface, same as every other sheet's header.
  dragHandlers?: SheetDragHandlers;
}) {
  const [name, setName] = useState(initial?.name ?? initialName);
  const [icon, setIcon] = useState<string | null>(initial?.icon ?? null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [ingredients, setIngredients] = useState<Ingredient[]>(initial?.ingredients ?? []);
  const [servings, setServings] = useState(String(initial?.servings ?? 4));
  const [weightOverride, setWeightOverride] = useState(
    initial && initial.totalWeightGrams !== initial.ingredients.reduce((s, i) => s + i.quantityGrams, 0)
      ? String(initial.totalWeightGrams)
      : ""
  );
  const [ingredientQuery, setIngredientQuery] = useState("");
  const { unit: energyUnit } = useEnergyUnit();

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
  // Same "% of macro calories" pill FoodDetailScreen's summary row uses —
  // reused here so a recipe's own macro balance reads the same way a single
  // food's does, rather than inventing a second convention for the same
  // number.
  const macroCalories = perServing ? perServing.protein * 4 + perServing.fat * 9 + perServing.carbs * 4 : 0;
  const caloricRatio = (cal: number) => (macroCalories > 0 ? Math.round((cal / macroCalories) * 100) : 0);

  const canSave = name.trim() !== "" && ingredients.length > 0 && servingsNum > 0 && totalWeightGrams > 0;
  // See CreateFoodForm's own autoIcon — same "Auto" preview ignoring the
  // current override, live as the name is typed.
  const autoIcon = getFoodIcon(name.trim() || "?");

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
      icon,
      servings: servingsNum,
      totalWeightGrams: weightOverride.trim() ? Number(weightOverride) : undefined,
      ingredients,
    });
  }

  return (
    <>
      <div {...dragHandlers} className="px-2.5 pt-1 pb-1 flex items-center gap-1 shrink-0 touch-none">
        <button
          onClick={onCancel}
          aria-label={initial ? "Close" : "Back"}
          className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-white active:bg-white/10"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <span className="text-sm font-medium text-white">{initial ? "Edit recipe" : "Create recipe"}</span>
      </div>

      {/* Enter submits via onKeyDown on the Name/Servings/Total-weight
          inputs, not a wrapping <form> — a <form> element turned out to be
          what triggers Chrome's full autofill accessory strip (passwords/
          payment/addresses icons) on Android for a name-field-plus-a-few-
          more-fields shape, regardless of autocomplete="off". See
          AddFoodSheet's QuickAddTab for the fuller story. The ingredient
          search box still deliberately does nothing on Enter (see its own
          onKeyDown below) — it's a live filter, not a field that should
          trigger saving the whole recipe. */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
        {/* Same icon+name "identity" composition as CreateFoodForm's Basics
            card — a recipe materializes as an ordinary foods row (see
            schema.ts), so it gets the same icon affordance a plain custom
            food does, not a lesser version of it. */}
        <div className="rounded-2xl bg-surface p-4">
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
              <span className="block text-xs text-muted mb-1.5">Name</span>
              <input
                type="search"
                // type="search" (not a bare type="text") is what actually
                // keeps Chrome's autofill accessory strip away on Android —
                // see AddFoodSheet's Quick Add tab for the fuller story.
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                autoComplete="off"
                placeholder="e.g. Chicken stir fry"
                className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent"
              />
            </label>
          </div>
        </div>

        <div>
          <span className="block text-xs text-muted mb-1.5">Ingredients</span>
          <input
            type="search"
            autoComplete="off"
            value={ingredientQuery}
            onChange={(e) => setIngredientQuery(e.target.value)}
            // This is a live filter, not a field with its own "confirm"
            // action — Enter here should never submit the whole recipe (the
            // form wrap above would otherwise do exactly that).
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            placeholder="Search foods to add…"
            className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent"
          />
          {ingredientQuery.trim() && (
            <div className="mt-2 rounded-2xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider max-h-48 overflow-y-auto">
              {search.data?.length === 0 && <p className="px-4 py-3 text-xs text-muted">No foods found.</p>}
              {search.data?.map((food) => (
                <button
                  key={food.id}
                  type="button"
                  onClick={() => addIngredient(food)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-surface-raised"
                >
                  <FoodIconAvatar name={food.name} icon={food.icon} className="w-8 h-8" />
                  <span className="text-sm text-white truncate min-w-0 flex-1">{food.name}</span>
                  <span className="tabular text-xs text-muted shrink-0">
                    {Math.round(kcalToUnit(food.caloriesPer100g, energyUnit))} {energyUnitLabel(energyUnit)}/100g
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {ingredients.length > 0 && (
          <div className="rounded-2xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider">
            {ingredients.map((ing, i) => (
              <div key={i} className="flex items-center gap-3 pl-4 pr-2.5 py-2">
                <FoodIconAvatar name={ing.food.name} icon={ing.food.icon} className="w-8 h-8" />
                <span className="text-sm text-white truncate min-w-0 flex-1">{ing.food.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="search"
                    inputMode="decimal"
                    autoComplete="off"
                    value={ing.quantityGrams}
                    onChange={(e) => updateQuantity(i, Math.max(0, Number(e.target.value) || 0))}
                    className="tabular w-14 bg-dashboardChip rounded-lg px-2 py-1.5 text-sm text-white text-right focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <span className="text-xs text-muted">g</span>
                  {/* h-9 w-9, not the original bare "×" glyph — that was a
                      ~24px hit area at best, easy to miss next to the gram
                      input right beside it. */}
                  <button
                    type="button"
                    onClick={() => removeIngredient(i)}
                    aria-label={`Remove ${ing.food.name}`}
                    className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-muted active:bg-white/10 active:text-white"
                  >
                    <X size={16} strokeWidth={2} />
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
              type="search"
              inputMode="decimal"
              autoComplete="off"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="tabular w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs text-muted">
                Total weight{" "}
                {!weightOverride.trim() && ingredientSumGrams > 0 && (
                  <span className="tabular">({Math.round(ingredientSumGrams)}g)</span>
                )}
              </span>
              {weightOverride.trim() !== "" && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setWeightOverride("");
                  }}
                  className="text-xs font-medium text-accent shrink-0"
                >
                  Reset
                </button>
              )}
            </span>
            <div className="flex items-center rounded-md bg-surface-raised border border-line px-3 focus-within:border-accent">
              <input
                type="search"
                inputMode="decimal"
                autoComplete="off"
                value={weightOverride}
                onChange={(e) => setWeightOverride(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder={String(Math.round(ingredientSumGrams))}
                className="tabular w-full bg-transparent py-2.5 text-sm text-white focus:outline-none"
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
          <div className="rounded-2xl bg-dashboardCard px-4 pt-3.5 pb-3">
            <div className="grid grid-cols-4 gap-2 items-end">
              <div className="text-center col-span-1">
                <p className="tabular text-xl font-bold text-calories leading-none">
                  {Math.round(kcalToUnit(perServing.calories, energyUnit))}
                </p>
                <p className="text-[10px] text-muted mt-1.5">{energyUnitLabel(energyUnit)}</p>
              </div>
              {(["protein", "carbs", "fat"] as const).map((key) => {
                const cal = key === "protein" ? perServing.protein * 4 : key === "fat" ? perServing.fat * 9 : perServing.carbs * 4;
                // Full literal class strings per branch, not a template-built
                // `bg-${key}/15` — Tailwind's JIT only picks up classes it
                // can find as complete strings in the source.
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
                    <p className="tabular text-base font-semibold text-white leading-none mt-1.5">
                      {perServing[key].toFixed(1)}
                    </p>
                    <p className="text-[10px] text-muted mt-0.5 capitalize">{key}</p>
                  </div>
                );
              })}
            </div>
            <p className="text-center text-[11px] text-muted pt-2 mt-2 border-t border-dashboardDivider">per serving</p>
          </div>
        )}
      </div>

      <div className="p-4 shrink-0">
        <button
          onClick={submit}
          disabled={!canSave}
          className="w-full py-3.5 rounded-xl bg-accent text-base disabled:opacity-40 font-semibold"
          style={{ color: "#0B1210" }}
        >
          {initial ? "Save changes" : "Save recipe"}
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
    </>
  );
}
