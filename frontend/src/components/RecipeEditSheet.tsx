import { useRecipeDetail, useUpdateRecipe, useDeleteRecipe } from "../api/recipes";
import RecipeForm from "./RecipeForm";
import BottomSheet from "./BottomSheet";

export default function RecipeEditSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useRecipeDetail(id);
  const updateRecipe = useUpdateRecipe(id);
  const deleteRecipe = useDeleteRecipe();

  function handleDelete() {
    if (!confirm(`Delete "${detail.data?.name}"? Any food it's already been logged as stays in your history.`)) return;
    deleteRecipe.mutate(id, { onSuccess: onClose });
  }

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line"
    >
      {detail.isLoading && <p className="p-4 text-sm text-muted">Loading…</p>}
      {detail.data && (
        <RecipeForm
          initialName={detail.data.name}
          initial={{
            name: detail.data.name,
            servings: detail.data.servings,
            totalWeightGrams: detail.data.totalWeightGrams,
            ingredients: detail.data.ingredients.map((i) => ({ food: i.food, quantityGrams: i.quantityGrams })),
          }}
          onCancel={onClose}
          onCreated={(input) => {
            updateRecipe.mutate(
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
      {detail.data && (
        <div className="px-4 pb-4 shrink-0">
          <button onClick={handleDelete} className="w-full py-2.5 text-sm text-muted">
            Delete recipe
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
