import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { useVisualViewportMetrics } from "../lib/useVisualViewportMetrics";

// Swipe-down-to-dismiss past this distance, or past this velocity even if
// short — the standard "flick it away" escape hatch native sheets have.
const DISMISS_DISTANCE_PX = 100;
const DISMISS_VELOCITY_PX_MS = 0.5;

// The one bottom-sheet shell for this app: backdrop, rounded black panel,
// grabber notch, and swipe-to-dismiss all live here so every sheet gets the
// same gesture for free instead of each one hand-rolling its own
// fixed/backdrop/panel boilerplate (which is what every sheet in this app
// did before this component existed). New sheets should build on this
// rather than copying the old three-div pattern.
//
// The drag gesture is only wired to the grabber notch, not the whole panel —
// attaching it to the full sheet would fight with scrollable content inside
// (e.g. a search results list), so the notch is the one deliberate
// drag-to-dismiss target, same as most native sheets.
export default function BottomSheet({
  onClose,
  children,
  panelClassName = "max-h-[85%] bg-dashboardBg rounded-t-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]",
  backdropClassName = "bg-black/60",
  showGrabber = true,
}: {
  onClose: () => void;
  children: ReactNode;
  panelClassName?: string;
  backdropClassName?: string;
  showGrabber?: boolean;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ y: number; time: number } | null>(null);
  const { height: viewportHeight, offsetTop: viewportOffsetTop } = useVisualViewportMetrics();

  // The page behind a sheet must not scroll while it's open — without this,
  // dragging on the dimmed backdrop scrolls whatever screen is underneath.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragStart.current = { y: e.clientY, time: Date.now() };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    setDragY(Math.max(0, e.clientY - dragStart.current.y));
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const distance = e.clientY - dragStart.current.y;
    const elapsed = Date.now() - dragStart.current.time;
    const velocity = distance / Math.max(elapsed, 1);
    dragStart.current = null;
    setDragging(false);
    if (distance > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY_PX_MS) {
      onClose();
    } else {
      setDragY(0);
    }
  }

  return (
    // Positioned/sized against the tracked visual viewport, not a plain
    // `fixed inset-0` — iOS Safari pans the visual viewport independently of
    // the layout viewport once the on-screen keyboard opens, which silently
    // pushes a plain `fixed` element (and anything sized in `vh`, which
    // doesn't reliably shrink for the keyboard either) outside what's
    // actually visible. Sizing this wrapper in real px against
    // window.visualViewport keeps it matching the true visible area, and
    // panelClassName heights below are expressed as `%` of *this* wrapper
    // rather than viewport units so they inherit that same correctness.
    <div className="fixed inset-x-0 z-50" style={{ top: viewportOffsetTop, height: viewportHeight }}>
      <div className={`absolute inset-0 ${backdropClassName}`} onClick={onClose} />
      <div
        className={`absolute inset-x-0 bottom-0 flex flex-col pointer-events-auto ${panelClassName}`}
        style={{ transform: `translateY(${dragY}px)`, transition: dragging ? "none" : "transform 200ms ease-out" }}
      >
        {showGrabber && (
          <div
            data-bottom-sheet-handle
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="flex justify-center pt-2 pb-1 shrink-0 touch-none cursor-grab active:cursor-grabbing"
          >
            <span className="h-1 w-10 rounded-full bg-white/20" />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
