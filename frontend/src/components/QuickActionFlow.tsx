import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Food } from "../api/types";
import { useRecipes, useCreateRecipe } from "../api/recipes";
import { localDateString } from "../lib/date";
import type { ShortcutId } from "../lib/shortcuts";
import AddFoodSheet from "./AddFoodSheet";
import QuickAddSheet from "./QuickAddSheet";
import CopyDaySheet from "./CopyDaySheet";
import RecipeForm from "./RecipeForm";
import LogWeightInline from "./LogWeightInline";
import BottomSheet from "./BottomSheet";

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
  const [pickedFood, setPickedFood] = useState<Food | null>(null);
  const [step, setStep] = useState<Step>(() => {
    if (action === "logWeight") return "logWeight";
    if (action === "newRecipe") return "newRecipe";
    if (action === "copyDay") return "copyDay";
    if (action === "recipes") return "recipesList";
    if (action === "quickAdd") return "quickAdd";
    return "addFood"; // search / scan
  });

  // Photos has no sheet of its own — jump straight there.
  if (action === "photos") {
    navigate("/photos");
    onClose();
    return null;
  }

  function pickRecipe(food: Food) {
    setPickedFood(food);
    setStep("addFood");
  }

  // Leaf flows that already own a full-screen backdrop+panel.
  if (step === "addFood") {
    return (
      <AddFoodSheet
        open
        date={today}
        editingEntry={null}
        initialStep={action === "scan" ? "scan" : "search"}
        initialFood={pickedFood ?? undefined}
        onClose={onClose}
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
      panelClassName="max-h-[85vh] bg-surface rounded-t-xl border-t border-line pb-[env(safe-area-inset-bottom)]"
    >
        {step === "recipesList" && (
          <>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
              <span className="text-sm font-medium">Log a recipe</span>
              <button onClick={onClose} className="text-muted text-xl leading-none px-1">
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pb-4">
              {recipes.data?.length === 0 && (
                <p className="px-4 py-4 text-sm text-muted">
                  No recipes yet — try "New recipe" from quick actions.
                </p>
              )}
              {recipes.data?.map((r) => (
                <button
                  key={r.id}
                  onClick={() => pickRecipe(r.food)}
                  className="w-full flex items-center justify-between px-4 py-2.5 border-b border-line/60 text-left active:bg-surface-raised"
                >
                  <span className="min-w-0">
                    <span className="block text-sm truncate">{r.name}</span>
                    <span className="block text-xs text-muted tabular">
                      {r.servings} serving{r.servings === 1 ? "" : "s"} · {Math.round(r.food.caloriesPer100g)}{" "}
                      kcal/100g
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "logWeight" && (
          <>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
              <span className="text-sm font-medium">Log weight</span>
              <button onClick={onClose} className="text-muted text-xl leading-none px-1">
                ×
              </button>
            </div>
            <div className="px-4 pb-4">
              <LogWeightInline onLogged={onClose} />
            </div>
          </>
        )}

        {step === "newRecipe" && (
          <RecipeForm
            initialName=""
            onCancel={onClose}
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
    </BottomSheet>
  );
}
