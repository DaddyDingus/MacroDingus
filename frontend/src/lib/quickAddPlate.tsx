import { useState } from "react";
import type { Food } from "../api/types";

// A food staged in an AddFoodSheet session but not yet written anywhere —
// this app has no client-side database (TanStack Query's own IndexedDB
// persistence covers offline/instant-reopen instead, see CLAUDE.md), so
// "staging" just means in-memory state that gets translated into one
// POST /api/logs/bulk call on commit.
export interface PlateItem {
  key: string;
  food: Food;
  quantityGrams: number;
  // Display-only, mirrors LogEntry.unitType/unitMeasureName — carried
  // through to the eventual POST /logs/bulk write so a plate item staged as
  // "2 servings" from FoodDetailScreen is remembered as such.
  unitType?: string;
  unitMeasureName?: string;
}

export interface PlateState {
  stagedPlate: PlateItem[];
  // quantityGrams is optional — the quick "+" add and Quick Add tab both
  // still just want the food's own default (serving size, or 100g), while
  // FoodDetailScreen's "Add to Plate" passes the specific amount the user
  // dialed in there (and the unit it was dialed in with).
  addToPlate: (food: Food, quantityGrams?: number, unit?: { unitType: string; unitMeasureName?: string }) => void;
  removeFromPlate: (key: string) => void;
  updatePlateItemQuantity: (key: string, quantityGrams: number) => void;
  clearPlate: () => void;
  editingPlateKey: string | null;
  setEditingPlateKey: (key: string | null) => void;
  nutritionView: "plate" | "day";
  setNutritionView: (v: "plate" | "day") => void;
}

// Backs one AddFoodSheet's plate — plain local state, always cleared on open
// (see AddFoodSheet.tsx's reset effect), so it doesn't need to survive
// unmounting. This used to also have a Context/Provider variant so
// QuickActionFlow's plate could survive being unmounted by its callers on
// dismiss (`{runningAction && <QuickActionFlow .../>}` in ShortcutsBar.tsx /
// QuickActionsSheet.tsx) — removed once every open started clearing the
// plate anyway, which made surviving the unmount pointless: React destroys
// local state on unmount regardless, so a freshly remounted AddFoodSheet
// already gets an empty plate for free.
export function usePlateState(): PlateState {
  const [stagedPlate, setStagedPlate] = useState<PlateItem[]>([]);
  const [editingPlateKey, setEditingPlateKey] = useState<string | null>(null);
  const [nutritionView, setNutritionView] = useState<"plate" | "day">("plate");

  function addToPlate(food: Food, quantityGrams?: number, unit?: { unitType: string; unitMeasureName?: string }) {
    setStagedPlate((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        food,
        quantityGrams: quantityGrams ?? food.servingSizeGrams ?? 100,
        unitType: unit?.unitType,
        unitMeasureName: unit?.unitMeasureName,
      },
    ]);
  }

  function removeFromPlate(key: string) {
    setStagedPlate((prev) => prev.filter((item) => item.key !== key));
  }

  function updatePlateItemQuantity(key: string, quantityGrams: number) {
    setStagedPlate((prev) => prev.map((item) => (item.key === key ? { ...item, quantityGrams } : item)));
  }

  function clearPlate() {
    setStagedPlate([]);
    setEditingPlateKey(null);
    setNutritionView("plate");
  }

  return {
    stagedPlate,
    addToPlate,
    removeFromPlate,
    updatePlateItemQuantity,
    clearPlate,
    editingPlateKey,
    setEditingPlateKey,
    nutritionView,
    setNutritionView,
  };
}
