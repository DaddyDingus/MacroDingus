import { useCallback, useEffect, useRef, useState } from "react";

// How far a finger must travel before the gesture is classified as a
// horizontal reveal or a vertical scroll. Deliberately below Chrome's own
// ~8px touch slop: once the browser has classified a sequence as a scroll it
// stops honouring preventDefault() and cancels the pointer stream outright,
// so a recognizer that only decides at 8px is racing something it has already
// lost. That race is what made swiping a food row so unreliable — a
// mostly-sideways drag would simply scroll the list instead (reported
// 2026-08-20). Deciding at 4px means the claim, and the preventDefault that
// goes with it, lands before the browser commits.
const CLAIM_PX = 4;
// How much more horizontal than vertical the travel must be to count as a
// reveal. Below 1 on purpose: over a list, vertical is the free native
// default (touch-action: pan-y) and stays available, so a drag that is
// roughly sideways should read as a reveal rather than be thrown away over a
// few pixels of incidental drift at a 4px sample.
const HORIZONTAL_RATIO = 0.8;

interface Session {
  x: number;
  y: number;
  baseX: number;
  // null until the gesture has moved far enough to tell horizontal from
  // vertical. It only ever becomes true — a vertical verdict ends the
  // session outright and hands the gesture back to the page untouched.
  horizontal: boolean | null;
}

// The swipe-left-to-reveal-Delete gesture shared by the Food Log's
// FoodItemCard and SwipeToDeleteRow (the Plate list and recipe ingredient
// list). Both had their own copy of the recognizer; the recognition itself is
// the part that was subtly wrong in both, so it lives in one place now.
//
// Touch is handled with native, non-passive listeners rather than React's
// pointer handlers for one reason: only a non-passive touchmove can call
// preventDefault() to stop the page scrolling, and React attaches its own
// touch listeners passively at the root, which makes preventDefault() from
// JSX a silent no-op. Mouse/pen still go through pointer events, which have
// no such restriction.
export function useSwipeToReveal({
  enabled,
  revealPx,
  maxDragPx,
  onOpenChange,
}: {
  enabled: boolean;
  revealPx: number;
  maxDragPx: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const session = useRef<Session | null>(null);

  const dragXRef = useRef(dragX);
  dragXRef.current = dragX;
  const openChangeRef = useRef(onOpenChange);
  openChangeRef.current = onOpenChange;

  // Only applies when no gesture is in flight, so an external close (another
  // row opening, multi-select starting) can't yank the row out from under a
  // finger that is mid-swipe.
  const syncOpen = useCallback(
    (open: boolean) => {
      if (session.current) return;
      setDragX(open ? -revealPx : 0);
    },
    [revealPx],
  );

  const close = useCallback(() => {
    session.current = null;
    setDragX(0);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const clamp = (v: number) => Math.min(0, Math.max(-maxDragPx, v));

    // A committed swipe must not also fire a click on whatever child button
    // the finger happened to lift over — the row body is a real button
    // (select/deselect). Pointer capture used to suppress that click as a
    // side effect; without it the swallow has to be explicit.
    function swallowNextClick() {
      const onClick = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el!.addEventListener("click", onClick, { capture: true, once: true });
      window.setTimeout(() => el!.removeEventListener("click", onClick, { capture: true }), 350);
    }

    function begin(x: number, y: number) {
      session.current = { x, y, baseX: dragXRef.current, horizontal: null };
    }

    // Returns true once this gesture belongs to us, i.e. the browser must not
    // be allowed to scroll for it.
    function move(x: number, y: number): boolean {
      const s = session.current;
      if (!s) return false;
      const dx = x - s.x;
      const dy = y - s.y;
      if (s.horizontal === null) {
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        if (ax < CLAIM_PX && ay < CLAIM_PX) return false;
        if (ax < ay * HORIZONTAL_RATIO) {
          // A vertical scroll that happened to start on this row — hand it
          // back to the page untouched rather than fighting it.
          session.current = null;
          return false;
        }
        s.horizontal = true;
        setDragging(true);
      }
      setDragX(clamp(s.baseX + dx));
      return true;
    }

    function end(x: number) {
      const s = session.current;
      session.current = null;
      if (!s?.horizontal) return;
      setDragging(false);
      const next = clamp(s.baseX + (x - s.x));
      const open = next <= -revealPx / 2;
      setDragX(open ? -revealPx : 0);
      openChangeRef.current?.(open);
      swallowNextClick();
    }

    const onTouchStart = (e: TouchEvent) => {
      // A second finger means a pinch/zoom or a two-handed scroll, neither of
      // which this gesture should try to interpret.
      if (e.touches.length !== 1) {
        session.current = null;
        return;
      }
      begin(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (move(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      end(t ? t.clientX : (session.current?.x ?? 0));
    };

    let pointerDetach: (() => void) | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // handled above, with preventDefault
      begin(e.clientX, e.clientY);
      const onPointerMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
      const onPointerUp = (ev: PointerEvent) => {
        end(ev.clientX);
        pointerDetach?.();
      };
      pointerDetach?.();
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
      pointerDetach = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        pointerDetach = null;
      };
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("pointerdown", onPointerDown);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("pointerdown", onPointerDown);
      pointerDetach?.();
      session.current = null;
    };
  }, [enabled, revealPx, maxDragPx]);

  return { ref, dragX, dragging, syncOpen, close };
}
