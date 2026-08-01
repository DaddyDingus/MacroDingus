import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { useRecipes } from "../api/recipes";
import { useAuthStatus, useLogout } from "../api/auth";
import { useTheme, THEME_CATALOG } from "../lib/theme";
import { useEnergyUnit, kcalToUnit, energyUnitLabel, type EnergyUnit } from "../lib/energyUnit";
import { useWeightUnit, type WeightUnit } from "../lib/weightUnit";
import RecipeEditSheet from "../components/RecipeEditSheet";
import ClearAccountDataSheet from "../components/ClearAccountDataSheet";

const ENERGY_UNITS: EnergyUnit[] = ["kcal", "kj"];
const WEIGHT_UNITS: WeightUnit[] = ["kg", "lb"];

export default function MoreScreen() {
  const navigate = useNavigate();
  const recipes = useRecipes();
  const authStatus = useAuthStatus();
  const logout = useLogout();
  const { theme, setTheme } = useTheme();
  const { unit: energyUnit, setUnit: setEnergyUnit } = useEnergyUnit();
  const { unit: weightUnit, setUnit: setWeightUnit } = useWeightUnit();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showClearData, setShowClearData] = useState(false);

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium">More</h1>
      </header>

      <main className="px-4 space-y-4 max-w-md mx-auto">
        <section className="border border-line bg-surface rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line">
            <span className="text-sm font-medium">Appearance</span>
          </div>
          {THEME_CATALOG.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-line/60 last:border-b-0 text-left active:bg-surface-raised"
            >
              <span
                className="shrink-0 w-7 h-7 rounded-full border border-line"
                style={{ backgroundColor: t.swatch }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{t.label}</span>
                <span className="block text-xs text-muted">{t.description}</span>
              </span>
              {theme === t.id && <Check size={18} className="shrink-0 text-accent" />}
            </button>
          ))}
        </section>

        <section className="border border-line bg-surface rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 flex items-center justify-between border-b border-line/60">
            <span className="text-sm font-medium">Energy unit</span>
            <div className="flex rounded-full border border-line overflow-hidden text-xs">
              {ENERGY_UNITS.map((u) => (
                <button
                  key={u}
                  onClick={() => setEnergyUnit(u)}
                  className={`px-2.5 py-1 ${energyUnit === u ? "bg-accent" : "text-muted"}`}
                  style={energyUnit === u ? { color: "#0B1210" } : undefined}
                >
                  {energyUnitLabel(u)}
                </button>
              ))}
            </div>
          </div>
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm font-medium">Weight unit</span>
            <div className="flex rounded-full border border-line overflow-hidden text-xs">
              {WEIGHT_UNITS.map((u) => (
                <button
                  key={u}
                  onClick={() => setWeightUnit(u)}
                  className={`px-2.5 py-1 ${weightUnit === u ? "bg-accent" : "text-muted"}`}
                  style={weightUnit === u ? { color: "#0B1210" } : undefined}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="border border-line bg-surface rounded-2xl overflow-hidden">
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
                  {r.servings} serving{r.servings === 1 ? "" : "s"} ·{" "}
                  {Math.round(kcalToUnit(r.food.caloriesPer100g, energyUnit))} {energyUnitLabel(energyUnit)}/100g
                </span>
              </span>
            </button>
          ))}
        </section>

        <section className="border border-line bg-surface rounded-2xl overflow-hidden">
          <button
            onClick={() => navigate("/photos")}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left active:bg-surface-raised"
          >
            <span className="text-sm font-medium">Progress photos</span>
            <span className="text-muted text-lg leading-none">›</span>
          </button>
        </section>

        <section className="border border-line bg-surface rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm">{authStatus.data?.user?.name}</span>
            <button onClick={() => logout.mutate()} className="text-xs text-accent">
              Log out
            </button>
          </div>
        </section>

        <section className="border border-line bg-surface rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowClearData(true)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left active:bg-surface-raised"
          >
            <span className="text-sm" style={{ color: "#D95926" }}>
              Clear Account Data
            </span>
            <span className="text-muted text-lg leading-none">›</span>
          </button>
        </section>
      </main>

      {editingId && <RecipeEditSheet id={editingId} onClose={() => setEditingId(null)} />}
      {showClearData && <ClearAccountDataSheet onClose={() => setShowClearData(false)} />}
    </div>
  );
}
