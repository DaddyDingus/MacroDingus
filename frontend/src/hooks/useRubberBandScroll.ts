import { useEffect } from "react";

// How much of the raw finger movement actually shows up as pull — <1 so it
// feels like pulling against resistance, not moving 1:1 with the finger.
const RESISTANCE = 0.4;
// Caps the stretch so a long, fast drag doesn't pull the page absurdly far.
const MAX_PULL_PX = 96;
const SPRING_BACK_MS = 320;
// How close to the bottom still counts as "at the bottom" — sub-pixel
// viewport heights (browser chrome, zoom) mean scrollY often stops a
// fraction short of the computed maximum.
const BOTTOM_EPSILON_PX = 4;

// Custom "rubber band" overscroll: dragging past the top or bottom of the
// page stretches it with resistance, then springs back on release —
// matching iOS's native feel, which Android/Chromium browsers (Samsung
// Internet included) don't have natively. index.css sets
// `overscroll-behavior-y: none` globally specifically so neither platform's
// own default (iOS's real bounce, Android's edge glow) shows through
// underneath/instead of this one — one consistent, deliberate feel on every
// device rather than whatever each browser happens to do.
//
// Offsets <body> via `position: relative` + `top`, not a CSS transform and
// not padding.
//
// Not a transform: a transform on any ancestor of a `position: fixed`
// element turns it into that transform's containing block instead of the
// real viewport (this app has hit exactly that bug before — see
// ShortcutsBar, which lives inside whichever screen is currently mounted and
// relies on staying fixed to the viewport regardless). `position: relative`
// has no such effect on fixed descendants.
//
// Not padding (which is what this originally used): padding-top does move
// the page down at the top edge, but padding-*bottom* just makes the
// document taller — the content doesn't move at all, and since scrollY stays
// put you see nothing whatsoever. That was the real reason the bottom edge
// never bounced while the top did. A relative `top` offset moves the painted
// content in both directions without touching scrollHeight at all, so
// there's also no scroll-metric churn mid-drag (no clamping, no maxScroll
// shifting underneath the gesture).
//
// `position: relative` is only set while a pull is actually in flight and
// removed after the spring-back, so any absolutely-positioned descendant
// that resolves against the initial containing block can only be affected
// during the few hundred ms of an overscroll gesture, never at rest.
//
// Touch-only (not pointer/mouse) — there's no equivalent "drag past the
// edge" gesture for a mouse wheel worth faking, and this is squarely a
// mobile-feel feature. Fling momentum that *ends* at an edge doesn't bounce
// either: the finger is already gone by then, and there's no exposed hook
// for the tail of a native momentum scroll.
interface DragState {
  edge: "top" | "bottom";
  // Whether we've taken the gesture over from native scrolling.
  active: boolean;
  // Previous touchmove's Y — arming keys off movement *since the last move*,
  // not since touchstart, so a gesture that scrolls the page all the way to
  // an edge and then reverses doesn't count its own earlier travel as pull.
  lastY: number;
  // Y at the exact moment this gesture armed. The pull is measured from
  // here, not from touchstart, so reaching the bottom edge halfway through
  // an already-long drag starts the stretch at 0 and grows with however much
  // further the finger travels past the boundary — rather than jumping
  // straight to full stretch because the whole gesture's delta was already
  // larger than MAX_PULL_PX.
  armedAtY: number;
}

export function useRubberBandScroll() {
  useEffect(() => {
    let drag: DragState | null = null;
    let springTimer = 0;

    function maxScroll() {
      return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    }

    // px > 0 pushes the page down (top-edge pull), px < 0 lifts it up
    // (bottom-edge pull).
    function setOffset(px: number) {
      document.body.style.position = "relative";
      document.body.style.top = `${px}px`;
    }

    function clearOffset() {
      window.clearTimeout(springTimer);
      document.body.style.transition = "";
      document.body.style.top = "";
      document.body.style.position = "";
    }

    function springBack() {
      document.body.style.transition = `top ${SPRING_BACK_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
      document.body.style.top = "0px";
      window.clearTimeout(springTimer);
      springTimer = window.setTimeout(clearOffset, SPRING_BACK_MS);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      // A sheet/modal owns scrolling right now (BottomSheet locks body
      // scroll while open — see its own overflow-hidden effect) — this
      // touch belongs to whatever's on top, not the page underneath it.
      if (document.body.style.overflow === "hidden") return;
      // A touch starting inside an element with this attribute owns its own
      // horizontal drag gesture (e.g. the Compare screen's before/after
      // slider) — a real finger swipe is never perfectly horizontal, and
      // without this the small vertical wobble in an otherwise-horizontal
      // swipe (with the page already at scrollY 0, which Compare usually
      // is) was enough to arm a pull-to-refresh stretch on top of the
      // slider's own drag, visibly shifting the whole page during what's
      // meant to be a purely horizontal gesture.
      if (e.target instanceof Element && e.target.closest("[data-no-rubber-band]")) return;
      // A previous pull may still be springing back; snap it home rather
      // than letting a stale transition animate over the new gesture.
      clearOffset();
      const y = e.touches[0].clientY;
      drag = { edge: "top", active: false, lastY: y, armedAtY: y };
    }

    function onTouchMove(e: TouchEvent) {
      if (!drag || e.touches.length !== 1) return;
      const currentY = e.touches[0].clientY;
      const moveDelta = currentY - drag.lastY;
      drag.lastY = currentY;

      if (!drag.active) {
        // Arms only while the finger is moving in the pull direction *and*
        // we're already sitting at that boundary — never mid-scroll, so a
        // normal scroll gesture keeps its native handling (momentum,
        // performance, all of it) right up until it genuinely runs out of
        // content.
        if (moveDelta > 0 && window.scrollY <= 0) {
          drag.edge = "top";
        } else if (moveDelta < 0 && window.scrollY >= maxScroll() - BOTTOM_EPSILON_PX) {
          drag.edge = "bottom";
        } else {
          return;
        }
        drag.active = true;
        drag.armedAtY = currentY;
        // Falls through rather than returning: `raw` is 0 on this very move,
        // which is fine (a 0px offset) and — critically — this is the move
        // that calls preventDefault first, which is what stops the browser
        // from starting its own scroll and rendering every later
        // preventDefault in the gesture a no-op. Returning here instead (as
        // an earlier version did, via a `raw <= 0` bail) re-armed on every
        // single move, so the pull distance never got a chance to grow past
        // zero and neither edge ever visibly bounced.
      }

      const raw = drag.edge === "top" ? currentY - drag.armedAtY : drag.armedAtY - currentY;
      if (raw < 0) {
        // Finger reversed back past the boundary mid-gesture — release
        // immediately rather than waiting for touchend, so it doesn't feel
        // sticky/laggy on a quick flick back into the real content.
        drag.active = false;
        clearOffset();
        return;
      }

      const pull = Math.min(MAX_PULL_PX, raw * RESISTANCE);
      document.body.style.transition = "none";
      setOffset(drag.edge === "top" ? pull : -pull);
      // Only once we're actually mid-pull — never on a normal scroll touch,
      // which must keep its default native handling. Guarded on `cancelable`
      // because a gesture that reached the bottom edge *after* native
      // scrolling had already begun is no longer cancelable in Chromium;
      // the offset above still renders correctly there, this call would just
      // log a console warning for nothing.
      if (e.cancelable) e.preventDefault();
    }

    function onTouchEnd() {
      if (drag?.active) springBack();
      drag = null;
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      clearOffset();
    };
  }, []);
}
