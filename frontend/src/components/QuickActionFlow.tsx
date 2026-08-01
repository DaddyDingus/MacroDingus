import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChefHat, ChevronRight } from "lucide-react";
import type { Food } from "../api/types";
import { useRecipes, useCreateRecipe } from "../api/recipes";
import { useDayLog } from "../api/logs";
import { usePrograms } from "../api/programs";
import { targetsForDate } from "../lib/programTargets";
import { localDateString } from "../lib/date";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import type { ShortcutId } from "../lib/shortcuts";
import AddFoodSheet from "./AddFoodSheet";
import QuickAddSheet from "./QuickAddSheet";
import CopyDaySheet from "./CopyDaySheet";
import RecipeForm from "./RecipeForm";
import LogWeightInline from "./LogWeightInline";
import BottomSheet from "./BottomSheet";
import FoodIconAvatar from "./FoodIconAvatar";

type Step = "recipesList" | "logWeight" | "newRecipe" | "copyDay" | "quickAdd" | "addFood";

// Runs a single quick action to completion (today's date always — date
// navigation stays on the Food log screen). Shared by the FAB's quick-actions
// menu and the Dashboard's pinned shortcut buttons, since a pinned shortcut
// is just a shortcut into this same flow, skipping the menu step. No meal
// selection anywhere in here — logging no longer tracks a meal at all (see
// backend/src/db/schema.ts), it's a straight timeline of when things were
// actually logged.
export default function QuickActionFlow({ action, onClose }: { action: ShortcutId; onClose: () => void }) {
  const navigate = useNavigate();
  const today = localDateString();
  const recipes = useRecipes();
  const createRecipe = useCreateRecipe();
  const dayLog = useDayLog(today);
  const programs = usePrograms();
  const { unit: energyUnit } = useEnergyUnit();
  const [pickedFood, setPickedFood] = useState<Food | null>(null);
  const [recipeQuery, setRecipeQuery] = useState("");
  const [step, setStep] = useState<Step>(() => {
    if (action === "logWeight") return "logWeight";
    if (action === "newRecipe") return "newRecipe";
    if (action === "copyDay") return "copyDay";
    if (action === "recipes") return "recipesList";
    if (action === "quickAdd") return "quickAdd";
    return "addFood"; // search / scan / newFood / describe
  });

  // Photos has no sheet of its own — jump straight there. Navigating (and
  // closing the menu that triggered this) has to happen in an effect, not
  // directly in the render body: onClose() sets state on an ancestor
  // (QuickActionsButton's `open`), and calling that synchronously while this
  // component is still rendering is exactly the "update a component while
  // rendering a different component" case React doesn't guarantee applies
  // correctly — in practice here it meant tapping "Photos" from the "+"
  // button's menu silently did nothing.
  useEffect(() => {
    if (action === "photos") {
      navigate("/photos");
      onClose();
    }
    // navigate/onClose deliberately not deps — both are fresh references on
    // every render (onClose especially, an inline arrow at the call site),
    // and this should only ever fire once, right when a "photos" instance
    // first mounts, not on every subsequent re-render of this component.
  }, [action]);

  if (action === "photos") return null;

  function pickRecipe(food: Food) {
    setPickedFood(food);
    setStep("addFood");
  }

  // Same "whichever program was active on the viewed date" lookup
  // TodayScreen uses, so the sheet's header badges match what the Food log
  // screen itself would show for today.
  const dayTargets = targetsForDate(programs.data ?? [], today);
  const targets = dayTargets
    ? { calories: dayTargets.calories, proteinG: dayTargets.proteinG, fatG: dayTargets.fatG, carbsG: dayTargets.carbsG }
    : null;

  // Leaf flows that already own a full-screen backdrop+panel.
  if (step === "addFood") {
    return (
      <AddFoodSheet
        open
        date={today}
        editingEntry={null}
        initialStep={action === "scan" ? "scan" : action === "newFood" ? "create" : action === "describe" ? "describe" : "search"}
        initialFood={pickedFood ?? undefined}
        onClose={onClose}
        totals={dayLog.data?.totals}
        targets={targets}
      />
    );
  }
  if (step === "quickAdd") {
    return <QuickAddSheet date={today} onClose={onClose} />;
  }
  if (step === "copyDay") {
    return <CopyDaySheet targetDate={today} onClose={onClose} />;
  }

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers, close) => (
        <>
        {step === "recipesList" && (
          <>
            {/* No Close button — swipe-down (the grabber, or this header) or
                a tap on the backdrop dismiss the sheet, so a redundant ×
                isn't needed. */}
            <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
              <span className="text-sm font-medium text-white">Log a recipe</span>
            </div>

            {recipes.data && recipes.data.length > 4 && (
              <div className="px-4 pb-2 shrink-0">
                <input
                  autoFocus
                  type="search"
                  autoComplete="off"
                  value={recipeQuery}
                  onChange={(e) => setRecipeQuery(e.target.value)}
                  placeholder="Search your recipes…"
                  className="w-full rounded-md bg-surface-raised border border-line px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent"
                />
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {recipes.data?.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <span className="h-11 w-11 rounded-full bg-dashboardCard flex items-center justify-center">
                    <ChefHat size={20} strokeWidth={2} className="text-muted" />
                  </span>
                  <p className="text-sm text-muted max-w-[220px]">
                    No recipes yet — try "New recipe" from quick actions.
                  </p>
                </div>
              )}
              {(() => {
                const q = recipeQuery.trim().toLowerCase();
                const filtered = q ? (recipes.data ?? []).filter((r) => r.name.toLowerCase().includes(q)) : recipes.data;
                if (filtered && filtered.length === 0 && q) {
                  return <p className="px-1 py-6 text-sm text-muted text-center">No recipes match "{recipeQuery}".</p>;
                }
                if (!filtered || filtered.length === 0) return null;
                return (
                  <div className="rounded-2xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider">
                    {filtered.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => pickRecipe(r.food)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-surface-raised"
                      >
                        <FoodIconAvatar name={r.name} icon={r.food.icon} className="w-8 h-8" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-white truncate">{r.name}</span>
                          <span className="block text-xs text-muted tabular">
                            {r.servings} serving{r.servings === 1 ? "" : "s"} ·{" "}
                            {Math.round(kcalToUnit(r.food.caloriesPer100g, energyUnit))} {energyUnitLabel(energyUnit)}/100g
                          </span>
                        </span>
                        <ChevronRight size={16} strokeWidth={2} className="text-muted shrink-0" />
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </>
        )}

        {step === "logWeight" && (
          <>
            <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
              <span className="text-sm font-medium text-white">Log weight</span>
            </div>
            <div className="px-4 pb-4">
              <LogWeightInline onLogged={onClose} autoFocus />
            </div>
          </>
        )}

        {step === "newRecipe" && (
          <RecipeForm
            initialName=""
            onCancel={close}
            dragHandlers={dragHandlers}
            onCreated={(input) => {
              createRecipe.mutate(
                {
                  name: input.name,
                  servings: input.servings,
                  totalWeightGrams: input.totalWeightGrams,
                  ingredients: input.ingredients.map((i) => ({ foodId: i.food.id, quantityGrams: i.quantityGrams })),
                },
                { onSuccess: onClose }
              );
            }}
          />
        )}
        </>
      )}
    </BottomSheet>
  );
}
