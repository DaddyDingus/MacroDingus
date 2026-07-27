import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";

// Drag the grabber past this distance, or flick it past this velocity, to
// snap to the other state — same thresholds/approach as BottomSheet.tsx's
// dismiss gesture, just deciding between two rest states instead of
// "dismiss vs. spring back."
const SNAP_DRAG_DISTANCE_PX = 60;
const SNAP_DRAG_VELOCITY_PX_MS = 0.4;

// A second, different kind of sheet from BottomSheet.tsx: that one has a
// single rest state and a drag-to-dismiss gesture over a dim backdrop.
// This one never dismisses — it lives permanently over its caller's
// background content and only toggles between two snap points (expanded /
// collapsed), so it doesn't want a backdrop, a dismiss callback, or
// BottomSheet's visual-viewport-tracked outer wrapper (the caller already
// positions this within its own already-viewport-tracked layout). Kept as
// its own component rather than bolting a second mode onto BottomSheet,
// since every other sheet in the app only ever needs the simple
// single-state dismiss behavior that component already provides.
export default function DraggableSnapSheet({
  expanded,
  onExpandedChange,
  panelHeight,
  collapsedPeek,
  children,
  panelClassName = "",
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  // The panel's own fixed rendered height in px (its "expanded" size) —
  // computed by the caller from real visual-viewport metrics, not vh/%, for
  // the same iOS-keyboard-correctness reasons documented on
  // useVisualViewportMetrics.
  panelHeight: number;
  // How much of that panel stays visible (translated into view) when
  // collapsed, in px.
  collapsedPeek: number;
  children: ReactNode;
  panelClassName?: string;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ y: number; time: number } | null>(null);

  // The panel's real CSS height tracks the current snap point directly
  // (collapsedPeek when collapsed, not panelHeight-translated-out-of-view) —
  // it used to always render at the full `panelHeight` and rely on
  // `transform: translateY` alone to "hide" the rest below the fold when
  // collapsed. That looked right, but the panel's own opaque background
  // still physically extended hundreds of px past what was visible, and —
  // because a `position: absolute` element with `z-index: auto` always
  // paints above plain in-flow siblings regardless of DOM order — that
  // invisible-looking overflow silently painted over anything the caller
  // placed below this component (confirmed via `elementFromPoint`: a caller
  // row well below the visible collapsed sliver was completely unclickable
  // and unreadable, covered by this panel's own background). Only an active
  // drag still uses `transform` for live finger-tracking feedback, since the
  // target height isn't known until the gesture ends; that's a genuine,
  // momentary exception, not a step back from this fix — the moment the
  // finger lifts, `restY` is discarded and the real height takes over.
  const restHeight = expanded ? panelHeight : collapsedPeek;

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragStart.current = { y: e.clientY, time: Date.now() };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    setDragY(e.clientY - dragStart.current.y);
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const distance = e.clientY - dragStart.current.y;
    const elapsed = Date.now() - dragStart.current.time;
    const velocity = distance / Math.max(elapsed, 1);
    dragStart.current = null;
    setDragging(false);
    setDragY(0);
    if (expanded && (distance > SNAP_DRAG_DISTANCE_PX || velocity > SNAP_DRAG_VELOCITY_PX_MS)) {
      onExpandedChange(false);
    } else if (!expanded && (-distance > SNAP_DRAG_DISTANCE_PX || -velocity > SNAP_DRAG_VELOCITY_PX_MS)) {
      onExpandedChange(true);
    }
  }

  return (
    <div
      className={`absolute inset-x-0 bottom-0 flex flex-col ${panelClassName}`}
      style={{
        height: restHeight,
        transform: dragY ? `translateY(${dragY}px)` : undefined,
        transition: dragging ? "none" : "height 220ms ease-out, transform 220ms ease-out",
      }}
    >
      <div
        data-snap-sheet-handle
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex justify-center pt-2 pb-1 shrink-0 touch-none cursor-grab active:cursor-grabbing"
      >
        <span className="h-1 w-10 rounded-full bg-white/20" />
      </div>
      {children}
    </div>
  );
}
