import { getFoodIcon } from "../lib/foodEmoji";
import FoodEmojiGlyph from "./FoodEmojiGlyph";

export interface IngredientIconPreview {
  name: string;
  icon: string | null;
}

// Stands in for FoodIconAvatar on a recipe log entry that has no custom
// emoji of its own (RecipeForm's icon picker) — a collage of up to 3
// ingredient icons instead of a single generic letter avatar. `ingredients`
// comes pre-trimmed to 3 by the backend (GET /api/logs' attachIngredientPreviews);
// this component only decides layout, not which ingredients to feature.
export default function RecipeIconStack({
  ingredients,
  className = "w-8 h-8",
}: {
  ingredients: IngredientIconPreview[];
  className?: string;
}) {
  const items = ingredients.slice(0, 3);
  return (
    <span className={`shrink-0 ${className} rounded-lg overflow-hidden grid grid-cols-2 grid-rows-2 gap-px bg-dashboardBg`}>
      {items.map((ing, i) => {
        const icon = getFoodIcon(ing.name, ing.icon);
        // Exactly 3: first tile spans the full top row (a wide top / two
        // narrow bottom triangle, the standard "group avatar" collage) so
        // the featured ingredient reads clearly instead of every tile being
        // an equally cramped quarter.
        const span = items.length === 3 && i === 0 ? "col-span-2" : "";
        return (
          <span key={i} className={`${span} bg-white/5 flex items-center justify-center overflow-hidden`}>
            {icon.kind === "emoji" ? (
              <FoodEmojiGlyph value={icon.value} className="w-[65%] h-[65%]" />
            ) : (
              <span className="text-[8px] font-bold text-white/80">{icon.value}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}
