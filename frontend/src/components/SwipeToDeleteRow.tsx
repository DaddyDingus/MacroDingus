import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { Trash2 } from "lucide-react";

// Width of the revealed Delete action — also how far a swipe has to travel
// past the halfway point to commit to "open" on release.
const REVEAL_PX = 84;
// A little further than REVEAL_PX so a fast/long swipe feels like it's
// pulling against something rather than hitting a hard wall.
const MAX_DRAG_PX = REVEAL_PX + 28;
const SNAP_MS = 200;
// A press doesn't commit to anything until it's moved this far, so a plain
// tap on the row underneath is never swallowed by gesture tracking that
// never actually left the ground.
const COMMIT_THRESHOLD_PX = 8;

// Same swipe-to-reveal-Delete gesture as the Food Log's FoodItemCard,
// factored out (2026-08-06) so the Plate list (AddFoodSheet) and Recipe
// ingredient list (RecipeForm) can have it too without re-deriving the
// pointer-capture/horizontal-vs-vertical recognition a third time.
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
  }

  return (
    <div className="relative overflow-hidden">
      {swipeEnabled && (
        <button
          type="button"
          aria-label={deleteLabel}
          onClick={() => {
            setDragX(0);
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
