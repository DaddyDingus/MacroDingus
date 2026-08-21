import { useEffect, useState } from "react";
import { Trash2, Flame } from "lucide-react";
import type { LogEntry } from "../api/types";
import FoodIconAvatar from "./FoodIconAvatar";
import RecipeIconStack from "./RecipeIconStack";
import { useEnergyUnit, kcalToUnit } from "../lib/energyUnit";
import { useSwipeToReveal } from "../hooks/useSwipeToReveal";

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

// Width of the revealed Delete action — also how far a swipe has to travel
// past the halfway point to commit to "open" on release.
const REVEAL_PX = 84;
// A little further than REVEAL_PX so a fast/long swipe feels like it's
// pulling against something rather than hitting a hard wall.
const MAX_DRAG_PX = REVEAL_PX + 28;
const SNAP_MS = 200;
// Must match the card's own `background-color 150ms` below — the Delete
// panel's mount is delayed by this long when swipe re-enables (see
// showDeletePanel), so it doesn't reappear mid-fade while the card's
// selected-state tint is still partially translucent.
const SELECTED_COLOR_MS = 150;

export default function FoodItemCard({
  entry,
  selected = false,
  swipeEnabled = true,
  open = false,
  onOpenChange,
  onSelect,
  onDelete,
}: {
  entry: LogEntry;
  selected?: boolean;
  // Off during multi-select — the row's own tap already means
  // select/deselect there, and the checkbox sits right where a swipe would
  // otherwise start.
  swipeEnabled?: boolean;
  // Lifted to TimeBlockGroup (not local state) so opening one row's Delete
  // action closes any other row already open in the same group.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { unit: energyUnit } = useEnergyUnit();
  const {
    ref: swipeRef,
    dragX,
    dragging,
    syncOpen,
    close: closeSwipe,
  } = useSwipeToReveal({ enabled: swipeEnabled, revealPx: REVEAL_PX, maxDragPx: MAX_DRAG_PX, onOpenChange });

  // Follows `open` when nothing is actively being dragged — covers both an
  // external close (another row opened, multi-select started) and this
  // row's own post-release snap already having set the right value locally.
  useEffect(() => {
    syncOpen(open);
  }, [open, syncOpen]);

  // Whether the Delete panel is actually mounted — lags `swipeEnabled`
  // turning true (leaving multi-select) by the same duration as the card's
  // own background-color fade back to opaque, so the panel isn't sitting
  // there to bleed through mid-fade the way it did before this delay
  // existed. Turning false (entering multi-select) still happens instantly:
  // nothing to bleed through if the panel's already gone.
  const [showDeletePanel, setShowDeletePanel] = useState(swipeEnabled);
  useEffect(() => {
    if (!swipeEnabled) {
      setShowDeletePanel(false);
      return;
    }
    const timer = window.setTimeout(() => setShowDeletePanel(true), SELECTED_COLOR_MS);
    return () => window.clearTimeout(timer);
  }, [swipeEnabled]);

  return (
    <div className="relative rounded-2xl overflow-hidden">
      {/* Sits behind the sliding card, revealed as it's dragged left.
          Matches ConfirmDeleteSheet's own warning color rather than a
          generic red, so "destructive" reads consistently app-wide. Gated
          on showDeletePanel rather than swipeEnabled directly: the
          `selected` state below (multi-select) drops the card's background
          to a translucent accent tint, and this panel would bleed through
          it — both at rest, and for as long as that tint takes to fade back
          to opaque when leaving multi-select, hence the matched delay. */}
      {showDeletePanel && (
        <button
          type="button"
          aria-label={`Delete ${entry.food.name}`}
          onClick={() => {
            closeSwipe();
            onOpenChange?.(false);
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
        // pan-y: the browser keeps handling vertical scrolling natively.
        // useSwipeToReveal only takes the gesture over once it reads as
        // horizontal, and does that within 4px so it beats the browser's own
        // scroll slop — a normal scroll starting on a food row is never
        // delayed or fought.
        style={{
          transform: `translateX(${dragX}px)`,
          // One inline transition covering both concerns: an inline
          // `transition` fully overrides the `transition-colors duration-150`
          // class below (same underlying longhands), so the selected-state
          // color fade has to be listed here too or it'd stop animating.
          transition: dragging ? "none" : `transform ${SNAP_MS}ms cubic-bezier(0.2, 0, 0, 1), background-color 150ms, border-color 150ms`,
          touchAction: "pan-y",
        }}
        // No data-no-rubber-band here (removed 2026-08-06) — it was an
        // upfront, whole-row opt-out applied at touchstart, before this
        // row's own horizontal-vs-vertical check has any chance to run.
        // Since most of a food log's vertical space is food rows, that
        // silently killed useRubberBandScroll's fling-based bounce (see that
        // hook's own comments) for almost every scroll gesture in the app,
        // while a slow drag starting on blank space (header, group
        // timestamps) still worked. The gesture doesn't need the opt-out to
        // be safe: a vertical scroll starting here is handed back untouched
        // and never preventDefault-ed, and a confirmed horizontal swipe
        // drives its visuals from React state (dragX), so it doesn't depend
        // on the touch event's default action being preserved.
        // Rounds only the left side while actually slid open (dragX < 0,
        // which can only happen when swipeEnabled — selected/multi-select
        // always keeps dragX at exactly 0). The right side needs to be
        // rounded at rest: relying on the outer wrapper's overflow-hidden
        // clip instead (leaving this div square all the time) sounded
        // equivalent but wasn't — a *border* drawn on a square-cornered box
        // and then clipped to a rounded mask doesn't sweep the same curve a
        // border on a genuinely rounded box does, so the selected-state
        // border looked cut off right at the corner even though the fill
        // behind it clipped fine.
        className={`relative flex items-center gap-2.5 px-3 py-1.5 border ${dragX === 0 ? "rounded-2xl" : "rounded-l-2xl"} ${
          selected ? "bg-accent/[0.12] border-accent/25" : "bg-dashboardCard border-transparent"
        }`}
      >
        {/* Whole row (icon, name/macros, and the calorie count) is one
            button now — the calorie number used to sit outside it as a bare
            sibling span, a dead zone where a tap did nothing instead of
            toggling selection like the rest of the row. */}
        <button onClick={onSelect} className="flex-1 min-w-0 flex items-center gap-2.5 text-left active:opacity-70">
          {entry.food.source === "recipe" && !entry.food.icon && entry.food.ingredientPreview?.length ? (
            <RecipeIconStack ingredients={entry.food.ingredientPreview} />
          ) : (
            <FoodIconAvatar name={entry.food.name} icon={entry.food.icon} />
          )}
          <span className="flex-1 min-w-0">
            <span className="block text-sm text-white leading-tight truncate">{entry.food.name}</span>
            {/* Macros before serving size (was serving size first) — the
                three macros are what's actually being compared entry to
                entry, so they lead; the gram weight is supporting detail. */}
            <span className="block text-xs tabular leading-tight truncate -mt-0.5 text-white/80">
              <span className="text-protein">P</span>{fmt(entry.nutrition.protein)}{" "}
              <span className="text-fat">F</span>{fmt(entry.nutrition.fat)}{" "}
              <span className="text-carbs">C</span>{fmt(entry.nutrition.carbs)} <span className="text-muted">·{" "}
              {fmt(entry.quantityGrams)} g</span>
            </span>
          </span>
          <span className="flex items-center gap-1 tabular text-sm shrink-0">
            <Flame className="w-3.5 h-3.5 text-calories" strokeWidth={2.5} />
            <span className="text-white">{fmt(kcalToUnit(entry.nutrition.calories, energyUnit))}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
