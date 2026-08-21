import { type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { useSwipeToReveal } from "../hooks/useSwipeToReveal";

// Width of the revealed Delete action — also how far a swipe has to travel
// past the halfway point to commit to "open" on release.
const REVEAL_PX = 84;
// A little further than REVEAL_PX so a fast/long swipe feels like it's
// pulling against something rather than hitting a hard wall.
const MAX_DRAG_PX = REVEAL_PX + 28;
const SNAP_MS = 200;

// Same swipe-to-reveal-Delete gesture as the Food Log's FoodItemCard,
// factored out (2026-08-06) so the Plate list (AddFoodSheet) and Recipe
// ingredient list (RecipeForm) can have it too. The recognizer itself now
// lives in useSwipeToReveal and is shared with FoodItemCard as well.
// FoodItemCard itself is left as its own component rather than rebuilt on
// this — it has its own selection/multi-select and "only one row open per
// time-group" (open state lifted to a parent) that these two simpler,
// single-item lists don't need.
export default function SwipeToDeleteRow({
  children,
  onDelete,
  deleteLabel,
  swipeEnabled = true,
  rowClassName = "",
}: {
  children: ReactNode;
  onDelete: () => void;
  deleteLabel: string;
  swipeEnabled?: boolean;
  // Applied to the sliding row itself — the outer wrapper stays a plain
  // relative+overflow-hidden box so callers keep control of the row's own
  // visual chrome (background, divider, padding, rounding).
  rowClassName?: string;
}) {
  const { ref: swipeRef, dragX, dragging, close } = useSwipeToReveal({
    enabled: swipeEnabled,
    revealPx: REVEAL_PX,
    maxDragPx: MAX_DRAG_PX,
  });

  return (
    <div className="relative overflow-hidden">
      {swipeEnabled && (
        <button
          type="button"
          aria-label={deleteLabel}
          onClick={() => {
            close();
            onDelete();
          }}
          className="absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-0.5 text-white"
          style={{ width: REVEAL_PX, background: "#D95926" }}
        >
          <Trash2 size={16} strokeWidth={2.2} />
          <span className="text-[10px] font-semibold">Delete</span>
        </button>
      )}
      <div
        ref={swipeRef}
        className={rowClassName}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? "none" : `transform ${SNAP_MS}ms cubic-bezier(0.2, 0, 0, 1)`,
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}
