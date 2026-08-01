import type { LogEntry } from "../api/types";
import { useCreateRecipe } from "../api/recipes";
import RecipeForm from "./RecipeForm";
import BottomSheet from "./BottomSheet";

// Opens the same recipe creator used elsewhere (QuickActionFlow's "New
// recipe", RecipeEditSheet), pre-filled with a selected time-group's own
// foods/weights as ingredients — so "these are what I actually ate together"
// becomes a reusable recipe without retyping every ingredient. Servings
// defaults to 1 (this group was one real serving of it, already eaten);
// totalWeightGrams defaults to the ingredient sum, same as a from-scratch
// recipe, so RecipeForm's own weight-override field starts blank.
export default function CreateRecipeFromGroupSheet({
  entries,
  onClose,
  onCreated,
}: {
  entries: LogEntry[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const createRecipe = useCreateRecipe();

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/60"
      panelClassName="max-h-[85%] bg-dashboardBg rounded-t-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers, close) => (
        <RecipeForm
          initialName=""
          initial={{
            name: "",
            servings: 1,
            totalWeightGrams: entries.reduce((sum, e) => sum + e.quantityGrams, 0),
            ingredients: entries.map((e) => ({ food: e.food, quantityGrams: e.quantityGrams })),
          }}
          onCancel={close}
          dragHandlers={dragHandlers}
          onCreated={(input) => {
            createRecipe.mutate(
              {
                name: input.name,
                icon: input.icon,
                servings: input.servings,
                totalWeightGrams: input.totalWeightGrams,
                ingredients: input.ingredients.map((i) => ({ foodId: i.food.id, quantityGrams: i.quantityGrams })),
              },
              { onSuccess: onCreated }
            );
          }}
        />
      )}
    </BottomSheet>
  );
}
