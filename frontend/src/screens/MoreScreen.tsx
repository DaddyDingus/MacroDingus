import { useState } from "react";
import { useRecipes } from "../api/recipes";
import { useAuthStatus, useLogout } from "../api/auth";
import RecipeEditSheet from "../components/RecipeEditSheet";

export default function MoreScreen() {
  const recipes = useRecipes();
  const authStatus = useAuthStatus();
  const logout = useLogout();
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium">More</h1>
      </header>

      <main className="px-4 space-y-4 max-w-md mx-auto">
        <section className="border border-line bg-surface rounded-md overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line">
            <span className="text-sm font-medium">My Recipes</span>
          </div>
          {recipes.data?.length === 0 && (
            <p className="px-4 py-4 text-sm text-muted">
              No recipes yet — create one from the "Add food" sheet on any meal.
            </p>
          )}
          {recipes.data?.map((r) => (
            <button
              key={r.id}
              onClick={() => setEditingId(r.id)}
              className="w-full flex items-center justify-between px-4 py-2.5 border-b border-line/60 last:border-b-0 text-left active:bg-surface-raised"
            >
              <span className="min-w-0">
                <span className="block text-sm truncate">{r.name}</span>
                <span className="block text-xs text-muted tabular">
                  {r.servings} serving{r.servings === 1 ? "" : "s"} · {Math.round(r.food.caloriesPer100g)} kcal/100g
                </span>
              </span>
            </button>
          ))}
        </section>

        <section className="border border-line bg-surface rounded-md overflow-hidden">
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm">{authStatus.data?.user?.name}</span>
            <button onClick={() => logout.mutate()} className="text-xs text-accent">
              Log out
            </button>
          </div>
        </section>
      </main>

      {editingId && <RecipeEditSheet id={editingId} onClose={() => setEditingId(null)} />}
    </div>
  );
}
