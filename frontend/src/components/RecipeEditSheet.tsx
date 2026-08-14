import { useState } from "react";
import { useRecipeDetail, useUpdateRecipe, useDeleteRecipe } from "../api/recipes";
import RecipeForm from "./RecipeForm";
import BottomSheet from "./BottomSheet";
import ConfirmDeleteSheet from "./ConfirmDeleteSheet";

export default function RecipeEditSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useRecipeDetail(id);
  const updateRecipe = useUpdateRecipe(id);
  const deleteRecipe = useDeleteRecipe();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      <BottomSheet
        onClose={onClose}
        backdropClassName="bg-black/50"
        panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line"
      >
        {(dragHandlers, close) => (
          <>
            {detail.isLoading && <p className="p-4 text-sm text-muted">Loading…</p>}
            {detail.data && (
              <RecipeForm
                initialName={detail.data.name}
                editingExisting
                initial={{
                  name: detail.data.name,
                  icon: detail.data.food.icon,
                  servings: detail.data.servings,
                  totalWeightGrams: detail.data.totalWeightGrams,
                  cookwareCalculation: detail.data.cookwareCalculation,
                  ingredients: detail.data.ingredients.map((i) => ({ food: i.food, quantityGrams: i.quantityGrams })),
                }}
                onCancel={close}
                dragHandlers={dragHandlers}
                onCreated={(input) => {
                  updateRecipe.mutate(
                    {
                      name: input.name,
                      icon: input.icon,
                      servings: input.servings,
                      totalWeightGrams: input.totalWeightGrams,
                      cookwareCalculation: input.cookwareCalculation,
                      ingredients: input.ingredients.map((i) => ({ foodId: i.food.id, quantityGrams: i.quantityGrams })),
                    },
                    { onSuccess: onClose }
                  );
                }}
              />
            )}
            {detail.data && (
              <div className="px-4 pb-4 shrink-0">
                <button onClick={() => setConfirmingDelete(true)} className="w-full py-2.5 text-sm text-muted">
                  Delete recipe
                </button>
              </div>
            )}
          </>
        )}
      </BottomSheet>
      {confirmingDelete && detail.data && (
        <ConfirmDeleteSheet
          title="Delete Recipe"
          message={`Delete "${detail.data.name}"? Any food it's already been logged as stays in your history.`}
          confirmLabel="Delete Recipe"
          onConfirm={() => deleteRecipe.mutate(id, { onSuccess: onClose })}
          onClose={() => setConfirmingDelete(false)}
          isPending={deleteRecipe.isPending}
        />
      )}
    </>
  );
}
