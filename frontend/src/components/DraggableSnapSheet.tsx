import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";

// Drag the grabber past this distance, or flick it past this velocity, to
// snap to the other state — same thresholds/approach as BottomSheet.tsx's
// dismiss gesture, just deciding between two rest states instead of
// "dismiss vs. spring back."
const SNAP_DRAG_DISTANCE_PX = 60;
const SNAP_DRAG_VELOCITY_PX_MS = 0.4;

// How far a pointer has to move before a press over one of the *extra* drag
// surfaces (the tab bar / collapsed icon row — real tappable buttons, unlike
// the plain grabber) commits to being a drag rather than a tap. Pointer
// capture is only taken once this is crossed, so a plain tap on a tab still
// reaches its own onClick completely normally — nothing is captured or
// prevented until the gesture has proven itself to be a real drag; only then
// does the ensuing click get rerouted to this wrapper instead of the button
// underneath, so a completed drag can't also fire an accidental tab switch.
const DRAG_COMMIT_THRESHOLD_PX = 8;

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
// Passed to `children` so the caller can wire the same drag gesture onto its
// own surfaces (e.g. the tab bar) in addition to the built-in grabber — see
// DRAG_COMMIT_THRESHOLD_PX above for why that's safe to layer over real
// buttons rather than stealing their taps.
export interface SnapDragHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

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
  // A render-prop (not plain ReactNode) so the caller can spread
  // `dragHandlers` onto its own tab bar / collapsed icon row, not just the
  // built-in grabber — the grabber alone was too easy to miss ("have to get
  // the handle exactly").
  children: (dragHandlers: SnapDragHandlers) => ReactNode;
  panelClassName?: string;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  // `captured` tracks whether this particular press has crossed
  // DRAG_COMMIT_THRESHOLD_PX yet — false the whole time for a plain tap on a
  // button sharing one of the extra drag surfaces, so endDrag can tell "real
  // drag that ended" apart from "tap that never became one" and leave the
  // latter alone entirely.
  const dragStart = useRef<{ y: number; time: number; captured: boolean } | null>(null);

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

  // Only animate `height` when `expanded` itself just flipped (a deliberate
  // drag/tap toggle) — not on every render where `restHeight` merely differs
  // from last time for some other reason while `expanded` stays the same.
  // The real case that matters: `panelHeight` is derived from
  // AddFoodSheet's visualViewport-tracked metrics, so it changes many times
  // in quick succession as the on-screen keyboard opens/closes (following
  // the keyboard's own real, already-smooth slide animation). Transitioning
  // `height` unconditionally meant each of those updates *restarted* a fresh
  // 220ms transition before the last one finished, producing a stuttery,
  // bouncy motion instead of one clean resize — this is what read as the
  // sheet "bouncing" when it first opened via a shortcut that auto-focuses
  // search (see AddFoodSheet's pendingSearchFocus). Comparing against a ref
  // updated every render (rather than in an effect) means this is correct
  // on the very render `expanded` changes, not one render late.
  const prevExpandedRef = useRef(expanded);
  const expandedJustToggled = prevExpandedRef.current !== expanded;
  prevExpandedRef.current = expanded;

  // Doesn't capture or commit to anything yet — just remembers where/when
  // the press started. This runs for the plain grabber too now, not just the
  // extra tab-bar/icon-row surfaces, unifying both onto the same
  // threshold-based recognition rather than the grabber capturing instantly
  // while the extra surfaces wait for a threshold.
  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragStart.current = { y: e.clientY, time: Date.now(), captured: false };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const distance = e.clientY - dragStart.current.y;
    if (!dragStart.current.captured && Math.abs(distance) > DRAG_COMMIT_THRESHOLD_PX) {
      // Committing now, mid-gesture, is what lets a plain tap on a button
      // sharing one of these surfaces pass through untouched: capture (and
      // the resulting rerouted click) only happens once real drag movement
      // has actually been observed.
      dragStart.current.captured = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    if (dragStart.current.captured) setDragY(distance);
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const { y, time, captured } = dragStart.current;
    const distance = e.clientY - y;
    const elapsed = Date.now() - time;
    const velocity = distance / Math.max(elapsed, 1);
    dragStart.current = null;
    setDragging(false);
    setDragY(0);
    // Never crossed the commit threshold — a plain tap (on a tab button, or
    // just a light touch on the grabber) — nothing was captured or
    // prevented, so its own onClick already fired normally; there's no snap
    // decision to make here.
    if (!captured) return;
    if (expanded && (distance > SNAP_DRAG_DISTANCE_PX || velocity > SNAP_DRAG_VELOCITY_PX_MS)) {
      onExpandedChange(false);
    } else if (!expanded && (-distance > SNAP_DRAG_DISTANCE_PX || -velocity > SNAP_DRAG_VELOCITY_PX_MS)) {
      onExpandedChange(true);
    }
  }

  const dragHandlers: SnapDragHandlers = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  // Entrance: start below the fold (translateY = restHeight so the panel is
  // offscreen), animate to translateY(0) on the next paint via the mounted
  // rAF. Using height (not translateY) for the normal collapsed/expanded
  // states avoids the paint-over bug documented above; translateY is only
  // used here for the one-shot entrance, then discarded once mounted.
  const entranceTranslate = !mounted ? restHeight : 0;

  return (
    <div
      className={`absolute inset-x-0 bottom-0 flex flex-col ${panelClassName}`}
      style={{
        height: restHeight,
        transform: dragY
          ? `translateY(${dragY}px)`
          : entranceTranslate
            ? `translateY(${entranceTranslate}px)`
            : undefined,
        transition: !mounted || dragging
          ? "none"
          : expandedJustToggled
            ? "height 300ms cubic-bezier(0.2, 0, 0, 1), transform 300ms cubic-bezier(0.2, 0, 0, 1)"
            : "transform 300ms cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      {/* Slim, mostly-visual notch — unlike BottomSheet.tsx's grabber this one
          never stood alone anyway (the tab row below already shares this same
          `dragHandlers` gesture, see the caller), so there's no need for the
          notch's own hit box to carry a full 44px touch target by itself. */}
      <div
        {...dragHandlers}
        data-snap-sheet-handle
        className="flex items-center justify-center h-6 shrink-0 touch-none cursor-grab active:cursor-grabbing"
      >
        <span className="h-1 w-9 rounded-full bg-white/20" />
      </div>
      {children(dragHandlers)}
    </div>
  );
}
