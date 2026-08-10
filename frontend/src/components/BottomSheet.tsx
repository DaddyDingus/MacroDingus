import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useVisualViewportMetrics } from "../lib/useVisualViewportMetrics";
import { useBackDismiss } from "../lib/useBackDismiss";
import { lockBodyScroll, unlockBodyScroll } from "../lib/bodyScrollLock";

// Swipe-down-to-dismiss past this distance, or past this velocity even if
// short — the standard "flick it away" escape hatch native sheets have.
const DISMISS_DISTANCE_PX = 100;
const DISMISS_VELOCITY_PX_MS = 0.5;
// Matches the transform transition's own duration below — the real onClose
// (which unmounts this component from the caller's side) fires only after
// this elapses, so the slide-down actually gets to play instead of being cut
// off by an instant unmount.
const CLOSE_ANIMATION_MS = 320;

// How far a pointer has to move before a press over the grabber (or over any
// extra surface a caller spreads these handlers onto — a header row, an icon
// grid) commits to being a drag. Below this it's left alone as a plain tap —
// same threshold/reasoning as DraggableSnapSheet.tsx's own commit gate,
// which is what lets a real button (Close ×, a shortcut icon) share space
// with the drag surface without losing its click.
const DRAG_COMMIT_THRESHOLD_PX = 8;

export interface SheetDragHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

// The one bottom-sheet shell for this app: backdrop, rounded panel, grabber
// notch, and swipe-to-dismiss all live here so every sheet gets the same
// gesture for free instead of each one hand-rolling its own
// fixed/backdrop/panel boilerplate (which is what every sheet in this app
// did before this component existed). New sheets should build on this
// rather than copying the old three-div pattern.
//
// The grabber notch used to be the sheet's whole visible/draggable top — a
// full h-11 (44px) empty strip just to give the small pill a comfortably
// large hit box. That reads as a big blank "forehead" (and, symmetrically, a
// "chin" of dead space below the pill before the header starts) purely for
// touch-target reasons, not visual ones. `children` is now a render prop —
// `(dragHandlers, close, scrollDragRef) => ReactNode` — so a caller can
// spread `dragHandlers` onto its own header row (or any other prominent
// non-scrolling surface, e.g. QuickActionsSheet's pinned-shortcut icon grid)
// in addition to the grabber. That's what lets the grabber itself shrink
// down to a slim, mostly-visual notch without losing an easy-to-hit drag
// target — every sheet's already-present header picks up the slack instead.
// Same commit-threshold trick DraggableSnapSheet/AddFoodSheet already use for
// their tab row: a plain tap on a real button sharing the surface still
// fires normally; only sustained movement past the threshold commits to a
// drag.
//
// `scrollDragRef` is a *different* mechanism for a caller's genuinely
// scrollable content (AiSettingsSheet's provider list, QuickActionsSheet's
// shortcut list) — attach it as that element's `ref`, don't spread
// `dragHandlers` there. Pointer Events can't win a swipe-to-dismiss over a
// live `overflow-y-auto` region: once the browser's own touch-scroll
// machinery claims the gesture (which it's free to do from the very first
// touchmove, since the region's `touch-action` has to stay `auto` for
// scrolling to work at all), it stops honouring anything JS does after the
// fact — confirmed as the sheet visually dragging down a few px then
// snapping back the instant native scroll took over. `scrollDragRef` instead
// wires a real non-passive `touchstart`/`touchmove` pair (see the effect
// below), the same technique hooks/useRubberBandScroll.ts already had to use
// for the identical problem at the page level: decide eligibility (already
// at `scrollTop` 0) at `touchstart`, before any movement, then
// `preventDefault()` on the very first qualifying move — that's the one
// call that actually stops the browser from starting its own scroll; every
// later `preventDefault()` in the same gesture is a no-op once native
// scrolling has already begun.
export default function BottomSheet({
  onClose,
  onBeforeClose,
  children,
  panelClassName = "max-h-[85%] bg-dashboardBg rounded-t-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]",
  backdropClassName = "bg-black/60",
  showGrabber = true,
}: {
  onClose: () => void;
  onBeforeClose?: () => boolean;
  children: ReactNode | ((
    dragHandlers: SheetDragHandlers,
    close: () => void,
    scrollDragRef: (el: HTMLElement | null) => void,
  ) => ReactNode);
  panelClassName?: string;
  backdropClassName?: string;
  showGrabber?: boolean;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Distinct from `mounted` (entrance) — set once anything decides to
  // dismiss, and drives an animated slide-down before the real `onClose`
  // (which unmounts this component from the caller's side) ever fires. Every
  // dismissal path in this file, and every consumer's own Cancel/Done/
  // pick-an-option button, needs to go through `close()` below rather than
  // calling `onClose` straight away, or it skips this animation entirely —
  // that gap (every close was instant, unconditionally, everywhere in the
  // app) is exactly what this state exists to fix.
  const [closing, setClosing] = useState(false);
  const dragStart = useRef<{ y: number; time: number; captured: boolean } | null>(null);
  const { height: viewportHeight, offsetTop: viewportOffsetTop } = useVisualViewportMetrics();

  function close() {
    if (closing) return; // already animating out — ignore a repeat trigger
    // Some sheets own drafted state and need to intercept every dismissal
    // path (backdrop, back button, or swipe) before the exit animation begins.
    // Returning false leaves this sheet fully mounted and interactive while
    // the caller presents its confirmation UI.
    if (onBeforeClose && !onBeforeClose()) return;
    // A sheet disappearing does not reliably dismiss Android's IME if its
    // focused input is unmounted in the same render. Blur while the field is
    // still present, synchronously inside the user's dismiss gesture, so the
    // regular keyboard leaves together with the panel.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setClosing(true);
    setTimeout(onClose, CLOSE_ANIMATION_MS);
  }

  // Every consumer of this shell only ever mounts it while conceptually
  // "open" (conditionally rendered by the caller, e.g. `{open && <...Sheet
  // .../>}`), so `active` is unconditionally true for as long as this
  // component exists — back closes the sheet instead of falling through to
  // whatever's underneath. Routed through `close()`, not `onClose` directly,
  // so a back-button dismissal animates the same as every other kind.
  useBackDismiss(true, close);

  // Entrance animation: mount at translateY(100%), then on the next paint
  // flip `mounted` so the panel slides up. rAF ensures the browser has
  // painted the initial off-screen position before the transition starts —
  // without it, React may batch the state update into the same paint as the
  // mount, making the transition invisible.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // The page behind a sheet must not scroll while it's open — without this,
  // dragging on the dimmed backdrop scrolls whatever screen is underneath.
  // `overflow: hidden` alone doesn't reliably block touch-driven scroll of
  // the document on mobile Chrome/Safari (it stops wheel/keyboard scroll,
  // but a finger drag can still walk the document a few px per event even
  // with the ancestor `overflow: hidden`) — pinning body to the current
  // scroll offset via `position: fixed` is what actually prevents it, since
  // there's then no scrollable box left for the touch to move at all. Losing
  // this lock is what caused the background to visibly scroll (and, via
  // useVisualViewportMetrics reacting to the resulting browser-chrome
  // show/hide, the sheet itself to jitter) while scrolling content inside a
  // sheet. Goes through the shared lockBodyScroll/unlockBodyScroll (not a
  // local save/restore) because two sheets can be mounted at once — e.g.
  // DayMenuSheet's "Carry Forward" row opens CarryForwardSheet in the same
  // click that starts DayMenuSheet's own close animation — and a local
  // save/restore in each instance stomps on the other's snapshot, eventually
  // stranding the page permanently unscrollable. See bodyScrollLock.ts.
  useEffect(() => {
    lockBodyScroll();
    return unlockBodyScroll;
  }, []);

  // Doesn't capture or commit to anything yet — just remembers where/when
  // the press started, same two-phase recognition DraggableSnapSheet uses so
  // a tap on a real button sharing this surface (Close ×, a shortcut icon)
  // still reaches its own onClick untouched.
  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (closing) return; // already animating away — don't restart a drag mid-close
    dragStart.current = { y: e.clientY, time: Date.now(), captured: false };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const distance = e.clientY - dragStart.current.y;
    if (!dragStart.current.captured && Math.abs(distance) > DRAG_COMMIT_THRESHOLD_PX) {
      dragStart.current.captured = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    if (dragStart.current.captured) setDragY(Math.max(0, distance));
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const { y, time, captured } = dragStart.current;
    const distance = e.clientY - y;
    const elapsed = Date.now() - time;
    const velocity = distance / Math.max(elapsed, 1);
    dragStart.current = null;
    setDragging(false);
    // Never crossed the commit threshold — a plain tap — nothing was
    // captured or prevented, so its own onClick already fired normally.
    if (!captured) return;
    if (distance > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY_PX_MS) {
      close();
    } else {
      setDragY(0);
    }
  }

  const dragHandlers: SheetDragHandlers = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  // Always-fresh refs for the touch effect below, which attaches its
  // listeners once on mount rather than every render (listener churn on a
  // `window`-level touchstart/touchmove pair isn't free) — `close` itself is
  // recreated every render and closes over that render's `onBeforeClose`
  // (e.g. AiSettingsSheet's, which reads live `hasUnsavedChanges`), so a
  // mount-captured `close` would silently act on stale state.
  const closeRef = useRef(close);
  closeRef.current = close;
  const closingRef = useRef(closing);
  closingRef.current = closing;
  const scrollElRef = useRef<HTMLElement | null>(null);
  const scrollDragRef = useCallback((el: HTMLElement | null) => {
    scrollElRef.current = el;
  }, []);

  // See the render-prop doc comment above for why this can't be Pointer
  // Events like the rest of this file's drag handling. Mirrors
  // hooks/useRubberBandScroll.ts's own onTouchStart/onTouchMove structure:
  // decide "blocking" (already at scrollTop 0) once at touchstart, register
  // touchmove non-passive only then, and require the *first* qualifying move
  // to be the one that calls preventDefault (falling through into the drag
  // update below rather than returning) so every later preventDefault in the
  // gesture isn't a no-op.
  useEffect(() => {
    let active = false;
    let armedAtY = 0;
    let gestureStartTime = 0;
    let moveAttached = false;

    function attachMove() {
      if (moveAttached) return;
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      moveAttached = true;
    }
    function detachMove() {
      if (!moveAttached) return;
      window.removeEventListener("touchmove", onTouchMove);
      moveAttached = false;
    }

    function onTouchStart(e: TouchEvent) {
      const el = scrollElRef.current;
      if (!el || closingRef.current || e.touches.length !== 1) return;
      if (!(e.target instanceof Node) || !el.contains(e.target)) return;
      if (el.scrollTop > 0) return; // not at the top edge — a normal scroll owns this touch
      active = false;
      armedAtY = e.touches[0].clientY;
      gestureStartTime = Date.now();
      attachMove();
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const currentY = e.touches[0].clientY;
      if (!active) {
        if (currentY - armedAtY <= 0) return; // upward, or hasn't moved — real scroll's job
        active = true;
        armedAtY = currentY; // this move becomes the 0px start of the drag, not a jump
        setDragging(true);
        // Falls through: this is the move that must call preventDefault.
      }
      const distance = currentY - armedAtY;
      if (distance < 0) {
        // Reversed back past the boundary mid-gesture — release immediately,
        // same as useRubberBandScroll's own edge-release, rather than
        // waiting for touchend to feel sticky.
        active = false;
        detachMove();
        setDragging(false);
        setDragY(0);
        return;
      }
      setDragY(distance);
      if (e.cancelable) e.preventDefault();
    }

    function onTouchEnd(e: TouchEvent) {
      detachMove();
      if (!active) return;
      active = false;
      const endY = e.changedTouches[0]?.clientY ?? armedAtY;
      const distance = endY - armedAtY;
      const elapsed = Date.now() - gestureStartTime;
      const velocity = distance / Math.max(elapsed, 1);
      setDragging(false);
      if (distance > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY_PX_MS) {
        closeRef.current();
      } else {
        setDragY(0);
      }
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      detachMove();
    };
  }, []);

  // Portaled straight to <body> rather than rendered in place. This sheet's
  // own panel below always carries an active `transform` (translateY, even
  // at 0px while at rest) — the same "transform on an ancestor permanently
  // creates a containing block for position:fixed descendants" gotcha noted
  // on the page-transition wrapper elsewhere in this app. Without the
  // portal, a sheet opened from *inside* another sheet (e.g. LogWeightInline's
  // CalendarJumpSheet, when LogWeightInline is itself rendered inside
  // QuickActionFlow's sheet) would have its own "fixed inset-0" scoped to
  // that ancestor panel's box instead of the real viewport — clipped by the
  // ancestor's bounds/overflow instead of appearing full-screen. Portaling
  // to body sidesteps the containing-block chain entirely, regardless of how
  // deeply nested the call site is; React's synthetic event bubbling and
  // context still work normally across the portal boundary.
  return createPortal(
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
      <div
        className={`absolute inset-0 ${backdropClassName} touch-none`}
        onClick={close}
        style={{
          opacity: mounted && !closing ? 1 : 0,
          transition: `opacity ${CLOSE_ANIMATION_MS}ms ease-out`,
        }}
      />
      <div
        className={`absolute inset-x-0 bottom-0 flex flex-col pointer-events-auto ${panelClassName}`}
        style={{
          transform: !mounted ? "translateY(100%)" : closing ? "translateY(100%)" : `translateY(${dragY}px)`,
          transition: !mounted || dragging ? "none" : `transform ${CLOSE_ANIMATION_MS}ms cubic-bezier(0.2, 0, 0, 1)`,
        }}
      >
        {showGrabber && (
          // Slim, mostly-visual notch now — the header a caller renders just
          // below shares this same drag gesture (spread via the render-prop
          // below) and provides the real, generously-sized touch target.
          <div
            {...dragHandlers}
            data-bottom-sheet-handle
            className="flex items-center justify-center h-6 shrink-0 touch-none cursor-grab active:cursor-grabbing"
          >
            <span className="h-1 w-9 rounded-full bg-white/20" />
          </div>
        )}
        {typeof children === "function" ? children(dragHandlers, close, scrollDragRef) : children}
      </div>
    </div>,
    document.body
  );
}
