import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Trash2, Flame } from "lucide-react";
import type { LogEntry } from "../api/types";
import FoodIconAvatar from "./FoodIconAvatar";
import RecipeIconStack from "./RecipeIconStack";
import { useEnergyUnit, kcalToUnit } from "../lib/energyUnit";

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
// Same two-phase recognition BottomSheet/DraggableSnapSheet use for their own
// drag surfaces: a press doesn't commit to anything until it's moved this
// far, so a plain tap (row select, the Delete action once revealed) is never
// swallowed by gesture tracking that never actually left the ground.
const COMMIT_THRESHOLD_PX = 8;

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
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{
    x: number;
    y: number;
    baseX: number;
    pointerId: number;
    // null until the gesture has moved enough to tell horizontal from
    // vertical; false means "let this be a normal vertical scroll/tap and
    // stop tracking it" rather than "closed".
    horizontal: boolean | null;
  } | null>(null);

  // Follows `open` when nothing is actively being dragged — covers both an
  // external close (another row opened, multi-select started) and this
  // row's own post-release snap already having set the right value locally.
  useEffect(() => {
    if (!dragStart.current) setDragX(open ? -REVEAL_PX : 0);
  }, [open]);

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

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!swipeEnabled) return;
    dragStart.current = { x: e.clientX, y: e.clientY, baseX: dragX, pointerId: e.pointerId, horizontal: null };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragStart.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.horizontal === null) {
      if (Math.abs(dx) < COMMIT_THRESHOLD_PX && Math.abs(dy) < COMMIT_THRESHOLD_PX) return;
      drag.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!drag.horizontal) {
        // A vertical scroll gesture that happened to start on this row —
        // hand it back to the page untouched rather than fighting it.
        dragStart.current = null;
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    setDragX(Math.min(0, Math.max(-MAX_DRAG_PX, drag.baseX + dx)));
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragStart.current;
    dragStart.current = null;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setDragging(false);
    if (!drag.horizontal) return; // never committed — the tap underneath already fired normally
    const next = Math.min(0, Math.max(-MAX_DRAG_PX, drag.baseX + (e.clientX - drag.x)));
    const shouldOpen = next <= -REVEAL_PX / 2;
    setDragX(shouldOpen ? -REVEAL_PX : 0);
    onOpenChange?.(shouldOpen);
  }

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
            setDragX(0);
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        // pan-y: the browser keeps handling vertical scrolling natively:
        // our own horizontal-vs-vertical check above only takes over once a
        // move is clearly horizontal, so a normal scroll starting on a food
        // row is never delayed or fought.
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
        // component's own horizontal-vs-vertical check (above) has any
        // chance to run. Since most of a food log's vertical space is food
        // rows, that silently killed useRubberBandScroll's fling-based
        // bounce (a fast flick that lifts the finger before the real edge,
        // then bounces once native momentum reaches it — see that hook's
        // own comments) for almost every scroll gesture in the app, while a
        // slow drag starting on blank space (header, group timestamps)
        // still worked. This component's own drag doesn't actually need
        // the opt-out to be safe: a plain vertical scroll starting here
        // already hands off untouched (dragStart.current = null above, no
        // setPointerCapture, no preventDefault), and a confirmed horizontal
        // swipe drives its visuals from React state (dragX) via
        // setPointerCapture, not from the browser's native touch handling —
        // so it doesn't depend on the touch event's default action being
        // preserved even in the rare case both gestures' recognizers are
        // live at once (already at the list's top/bottom edge with a swipe
        // that has a little incidental vertical wobble).
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
        className={`relative flex items-center gap-2.5 px-3 py-2 border ${dragX === 0 ? "rounded-2xl" : "rounded-l-2xl"} ${
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
            <span className="block text-xs tabular leading-tight truncate -mt-0.5 text-white/70">
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
