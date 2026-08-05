import { useState } from "react";
import { ChevronLeft, ChevronRight, CookingPot, Pencil, Plus, X } from "lucide-react";
import type { Food } from "../api/types";
import { scaleNutrition, sumNutrition } from "../lib/nutrition";
import { localDateString } from "../lib/date";
import FoodIconAvatar from "./FoodIconAvatar";
import IconPickerModal from "./IconPickerModal";
import AddFoodSheet from "./AddFoodSheet";
import FoodEmojiGlyph from "./FoodEmojiGlyph";
import FoodDetailScreen from "./FoodDetailScreen";
import CreateFoodForm from "./CreateFoodForm";
import DiscardWarningSheet from "./DiscardWarningSheet";
import { getFoodIcon } from "../lib/foodEmoji";
import type { SheetDragHandlers } from "./BottomSheet";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import { useFavorites, useAddFavorite, useRemoveFavorite } from "../api/favorites";
import { useCreateFood } from "../api/foods";
import type { CookwareItem } from "../api/cookware";
import CookwareSheet from "./CookwareSheet";
import DecimalInput from "./DecimalInput";

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
  editingExisting = false,
  onCancel,
  onCreated,
  dragHandlers,
}: {
  initialName: string;
  initial?: RecipeFormInitial;
  // Distinct from `initial` (which only means "prefilled") — URL import,
  // "Duplicate," and this form's own ingredient-picker prefill all set
  // `initial` on a recipe that's still genuinely new/unsaved, so header/
  // button copy keys off this instead. Only RecipeEditSheet's real
  // edit-in-place sets it true.
  editingExisting?: boolean;
  onCancel: () => void;
  onCreated: (input: { name: string; icon: string | null; servings: number; totalWeightGrams?: number; ingredients: Ingredient[] }) => void;
  // Spread onto this form's own header (below) when it's rendered directly
  // as a BottomSheet's child (RecipeEditSheet, CreateRecipeFromGroupSheet) —
  // lets that header double as the sheet's drag-to-dismiss surface, same as
  // every other sheet's header.
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
  const [selectedCookware, setSelectedCookware] = useState<CookwareItem | null>(null);
  const [scaleWeight, setScaleWeight] = useState("");
  const [cookwarePickerOpen, setCookwarePickerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Which totals the nutrition card at the bottom shows — same Plate/Day
  // segmented-pill pattern AddFoodSheet's own StagedPlateSection uses for an
  // analogous "which totals" toggle, reused here rather than a second
  // convention for the same kind of choice.
  const [nutritionView, setNutritionView] = useState<"serving" | "recipe">("serving");
  // Gate for the header's own back/close button — only a brand-new recipe
  // (no `initial`) with at least one ingredient already added risks losing
  // real work by leaving, so an already-saved recipe being edited (`initial`
  // set) skips this even if it happens to have ingredients too.
  const [showDiscardWarning, setShowDiscardWarning] = useState(false);
  // Tapping an already-added ingredient's row opens the same FoodDetailScreen
  // the picker itself uses (see the "Add ingredient" button's own comment
  // below) — an index into `ingredients`, not the food itself, since saving
  // needs to know which row to update. customFromIndex is a distinct,
  // separate step ("+ To custom" from within that detail view) rather than
  // reusing detailIndex, since the two screens are mounted at the same time
  // for one frame during the handoff (detail closes, create-food opens).
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const [customFromIndex, setCustomFromIndex] = useState<number | null>(null);
  const { unit: energyUnit } = useEnergyUnit();
  const favorites = useFavorites();
  const addFavorite = useAddFavorite();
  const removeFavorite = useRemoveFavorite();
  const createFood = useCreateFood();
  const favoriteFoodIds = new Set(favorites.data?.map((f) => f.id));

  function toggleFavorite(food: Food) {
    if (favoriteFoodIds.has(food.id)) removeFavorite.mutate(food.id);
    else addFavorite.mutate(food.id);
  }

  const ingredientSumGrams = ingredients.reduce((sum, i) => sum + i.quantityGrams, 0);
  const scaleWeightGrams = Number(scaleWeight);
  const totalWeightGrams = selectedCookware
    ? scaleWeight.trim()
      ? scaleWeightGrams - selectedCookware.weightGrams
      : 0
    : weightOverride.trim()
      ? Number(weightOverride)
      : ingredientSumGrams;
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
  // What the nutrition card actually renders — per-serving figures, or the
  // whole recipe's totals, per nutritionView above. Falls back to totals
  // even while "serving" is selected if perServing can't be computed
  // (servings left blank/zero) — the card still has something real to show
  // rather than going blank over an unrelated field.
  const displayedNutrition = nutritionView === "serving" && perServing ? perServing : totals;
  // Same "% of macro calories" pill FoodDetailScreen's summary row uses —
  // reused here so a recipe's own macro balance reads the same way a single
  // food's does, rather than inventing a second convention for the same
  // number. Ratios are identical whether computed per-serving or for the
  // whole recipe (scaling every macro by the same factor doesn't change
  // their relative share), so this doesn't need its own toggle — it's
  // always sourced from whatever's currently displayed.
  const macroCalories = displayedNutrition.protein * 4 + displayedNutrition.fat * 9 + displayedNutrition.carbs * 4;
  const caloricRatio = (cal: number) => (macroCalories > 0 ? Math.round((cal / macroCalories) * 100) : 0);

  const canSave = name.trim() !== "" && ingredients.length > 0 && servingsNum > 0 && totalWeightGrams > 0;
  // See CreateFoodForm's own autoIcon — same "Auto" preview ignoring the
  // current override, live as the name is typed.
  const autoIcon = getFoodIcon(name.trim() || "?");

  // AddFoodSheet's own commit — the whole staged batch arrives here in one
  // call once "Add Ingredients" is actually tapped (see its onPickItems);
  // nothing lands here just from picking foods in the sheet, so closing that
  // sheet without committing (X, back, swipe-down) leaves this untouched.
  function addIngredients(items: { food: Food; quantityGrams: number }[]) {
    setIngredients((prev) => [...prev, ...items]);
  }

  function requestCancel() {
    if (!initial && ingredients.length > 0) {
      setShowDiscardWarning(true);
    } else {
      onCancel();
    }
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
      totalWeightGrams: selectedCookware
        ? totalWeightGrams
        : weightOverride.trim()
          ? Number(weightOverride)
          : undefined,
      ingredients,
    });
  }

  return (
    <>
      <div {...dragHandlers} className="px-2.5 pt-1 pb-1 flex items-center gap-1 shrink-0 touch-none">
        <button
          onClick={requestCancel}
          aria-label={editingExisting ? "Close" : "Back"}
          className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-white active:bg-white/10"
        >
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
        <span className="text-sm font-medium text-white">{editingExisting ? "Edit recipe" : "Create recipe"}</span>
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
              <FoodEmojiGlyph value={icon ?? autoIcon.value} className="w-9 h-9" />
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
          {/* Opens the same Search/Scan/Quick Add/Library sheet the Food Log
              uses, in "pick" mode (see AddFoodSheet's onPickItems) — picks
              stage onto that sheet's own plate exactly like logging does
              (shown as icons in its header instead of macro bars, which
              wouldn't mean anything for a recipe), and only land here once
              "Add Ingredients" is actually tapped. Swiping the sheet away
              without tapping it discards whatever was staged. */}
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-md border border-dashed border-line px-3 py-2.5 text-sm text-muted active:bg-surface-raised"
          >
            <Plus size={16} strokeWidth={2} />
            Add ingredient
          </button>
        </div>

        {ingredients.length > 0 && (
          <div className="rounded-2xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider">
            {ingredients.map((ing, i) => (
              <div key={i} className="flex items-center gap-3 pl-4 pr-2.5 py-2">
                <button
                  type="button"
                  onClick={() => setDetailIndex(i)}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left active:opacity-70"
                >
                  <FoodIconAvatar name={ing.food.name} icon={ing.food.icon} className="w-8 h-8" />
                  <span className="text-sm text-white truncate min-w-0">{ing.food.name}</span>
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  <DecimalInput
                    label={`${ing.food.name} quantity`}
                    value={String(ing.quantityGrams)}
                    onChange={(value) => updateQuantity(i, Math.max(0, Number(value) || 0))}
                    allowDecimal={false}
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
            <DecimalInput
              label="Recipe servings"
              value={servings}
              onChange={setServings}
              className="tabular w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm text-white text-left focus:outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs text-muted">
                {selectedCookware ? "Scale weight" : "Total weight"}{" "}
                {!selectedCookware && !weightOverride.trim() && ingredientSumGrams > 0 && (
                  <span className="tabular">({Math.round(ingredientSumGrams)}g)</span>
                )}
              </span>
              {(selectedCookware ? scaleWeight.trim() : weightOverride.trim()) !== "" && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    if (selectedCookware) setScaleWeight("");
                    else setWeightOverride("");
                  }}
                  className="text-xs font-medium text-accent shrink-0"
                >
                  {selectedCookware ? "Clear" : "Reset"}
                </button>
              )}
            </span>
            <div className="flex items-center rounded-md bg-surface-raised border border-line px-3 focus-within:border-accent">
              <DecimalInput
                label={selectedCookware ? "Scale weight" : "Total recipe weight"}
                value={selectedCookware ? scaleWeight : weightOverride}
                onChange={(value) => selectedCookware ? setScaleWeight(value) : setWeightOverride(value)}
                placeholder={selectedCookware ? "0" : String(Math.round(ingredientSumGrams))}
                className="tabular w-full bg-transparent py-2.5 text-sm text-white text-left focus:outline-none"
              />
              <span className="text-xs text-muted">g</span>
            </div>
          </label>
        </div>
        <button
          type="button"
          onClick={() => setCookwarePickerOpen(true)}
          className="w-full flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left active:bg-surface-raised"
        >
          <span className="w-8 h-8 rounded-lg bg-surface-raised flex items-center justify-center text-muted shrink-0">
            <CookingPot size={16} strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted">Pot or dish</span>
            <span className="block text-sm text-white truncate">
              {selectedCookware ? selectedCookware.name : "None — entering food weight directly"}
            </span>
          </span>
          {selectedCookware && (
            <span className="text-xs text-muted tabular shrink-0">{Math.round(selectedCookware.weightGrams).toLocaleString()} g</span>
          )}
          <ChevronRight size={16} strokeWidth={2.5} className="text-muted shrink-0" />
        </button>
        {selectedCookware ? (
          scaleWeight.trim() && totalWeightGrams > 0 ? (
            <div className="rounded-xl bg-carbs/10 border border-carbs/20 px-3 py-2.5 -mt-1">
              <p className="text-xs text-muted">Prepared food weight</p>
              <p className="tabular text-sm mt-0.5">
                {Math.round(scaleWeightGrams).toLocaleString()} g − {Math.round(selectedCookware.weightGrams).toLocaleString()} g ={" "}
                <span className="font-semibold text-carbs">{Math.round(totalWeightGrams).toLocaleString()} g</span>
              </p>
            </div>
          ) : (
            <p className={`text-xs -mt-1 ${scaleWeight.trim() ? "text-protein" : "text-muted"}`}>
              {scaleWeight.trim()
                ? `Scale weight must be greater than ${Math.round(selectedCookware.weightGrams).toLocaleString()} g.`
                : "Enter the combined weight of the finished food and dish."}
            </p>
          )
        ) : (
          <p className="text-xs text-muted -mt-2">
            Only override the weight if cooking changed it (water lost or absorbed) — calories don't change, but
            nutrition per gram does.
          </p>
        )}

        {ingredients.length > 0 && (
          <div className="rounded-2xl bg-dashboardCard px-4 pt-3.5 pb-3">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-[11px] tracking-widest uppercase text-muted">Nutrition</p>
              {/* One button spanning both labels, same pattern as
                  AddFoodSheet's StagedPlateSection Plate/Day toggle — "tap
                  the one you want" and "tap anywhere to flip to the other"
                  are the same action. Disabled (not hidden) while perServing
                  can't be computed, so the control doesn't jump around as
                  servings is typed. */}
              <button
                type="button"
                onClick={() => setNutritionView((v) => (v === "serving" ? "recipe" : "serving"))}
                disabled={!perServing}
                className="flex rounded-full bg-dashboardChip p-0.5 text-[11px] disabled:opacity-40"
              >
                <span
                  className={`px-3 py-1 rounded-full transition-colors ${
                    nutritionView === "serving" && perServing ? "bg-white text-black font-medium" : "text-muted"
                  }`}
                >
                  Serving
                </span>
                <span
                  className={`px-3 py-1 rounded-full transition-colors ${
                    nutritionView === "recipe" || !perServing ? "bg-white text-black font-medium" : "text-muted"
                  }`}
                >
                  Recipe
                </span>
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2 items-end">
              <div className="text-center col-span-1">
                <p className="tabular text-xl font-bold text-calories leading-none">
                  {Math.round(kcalToUnit(displayedNutrition.calories, energyUnit))}
                </p>
                <p className="text-[10px] text-muted mt-1.5">{energyUnitLabel(energyUnit)}</p>
              </div>
              {(["protein", "carbs", "fat"] as const).map((key) => {
                const cal =
                  key === "protein"
                    ? displayedNutrition.protein * 4
                    : key === "fat"
                      ? displayedNutrition.fat * 9
                      : displayedNutrition.carbs * 4;
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
                      {displayedNutrition[key].toFixed(1)}
                    </p>
                    <p className="text-[10px] text-muted mt-0.5 capitalize">{key}</p>
                  </div>
                );
              })}
            </div>
            <p className="text-center text-[11px] text-muted pt-2 mt-2 border-t border-dashboardDivider">
              {nutritionView === "serving" && perServing ? "per serving" : `whole recipe${servingsNum > 0 ? ` · ${servingsNum} serving${servingsNum === 1 ? "" : "s"}` : ""}`}
            </p>
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
          {editingExisting ? "Save changes" : "Save recipe"}
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

      {cookwarePickerOpen && (
        <CookwareSheet
          selectedId={selectedCookware?.id}
          onSelect={(item) => {
            setSelectedCookware(item);
            setScaleWeight("");
          }}
          onClose={() => setCookwarePickerOpen(false)}
        />
      )}

      <AddFoodSheet
        open={pickerOpen}
        date={localDateString()}
        editingEntry={null}
        onClose={() => setPickerOpen(false)}
        onPickItems={addIngredients}
        commitLabel="Add Ingredients"
      />

      {/* absolute inset-0, not fixed — RecipeForm is a Fragment with no DOM
          node of its own, hosted either inside AddFoodSheet's own fixed
          full-screen container (the "recipe" step) or inside a BottomSheet
          panel (RecipeEditSheet/CreateRecipeFromGroupSheet). BottomSheet's
          panel keeps a live `transform: translateY(...)` even at rest (never
          `none`), which makes it the containing block for any `fixed`
          descendant per the CSS spec — a `fixed` overlay here would end up
          boxed to the sheet's own panel instead of the real viewport in that
          context. `absolute inset-0` instead just fills whichever positioned
          ancestor is actually hosting this component, correctly either way. */}
      {detailIndex !== null && ingredients[detailIndex] && (
        <div className="absolute inset-0 z-10 bg-dashboardBg flex flex-col">
          <FoodDetailScreen
            food={ingredients[detailIndex].food}
            initialQuantityGrams={ingredients[detailIndex].quantityGrams}
            backLabel="Close"
            onBack={() => setDetailIndex(null)}
            // Unused: `editing` below swaps the footer to Delete/Save, so
            // Add/Log Foods's own handlers are never invoked in this mode
            // (see FoodDetailScreen's own prop doc).
            onAdd={() => {}}
            onLogFoods={() => {}}
            onSaveAsCustom={() => setCustomFromIndex(detailIndex)}
            hideTargetsUi
            isFavorite={favoriteFoodIds.has(ingredients[detailIndex].food.id)}
            onToggleFavorite={toggleFavorite}
            editing={{
              onSave: (quantityGrams) => {
                updateQuantity(detailIndex, quantityGrams);
                setDetailIndex(null);
              },
              onDelete: () => {
                removeIngredient(detailIndex);
                setDetailIndex(null);
              },
            }}
          />
        </div>
      )}

      {showDiscardWarning && (
        <DiscardWarningSheet
          title={`${ingredients.length} ingredient${ingredients.length === 1 ? "" : "s"} added`}
          message="This recipe hasn't been saved yet — leaving now will discard it."
          confirmLabel="Discard"
          onCancel={() => setShowDiscardWarning(false)}
          onConfirm={() => {
            setShowDiscardWarning(false);
            onCancel();
          }}
        />
      )}

      {customFromIndex !== null && ingredients[customFromIndex] && (
        <div className="absolute inset-0 z-20 bg-dashboardBg flex flex-col">
          <CreateFoodForm
            initialName={ingredients[customFromIndex].food.name}
            prefillFood={ingredients[customFromIndex].food}
            onCancel={() => setCustomFromIndex(null)}
            onCreated={(food) => {
              const index = customFromIndex;
              createFood.mutate(food, {
                onSuccess: (created) => {
                  setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, food: created } : ing)));
                },
              });
              setCustomFromIndex(null);
              setDetailIndex(null);
            }}
          />
        </div>
      )}
    </>
  );
}
