import { useEffect } from "react";

// How much of the raw finger movement actually shows up as pull — <1 so it
// feels like pulling against resistance, not moving 1:1 with the finger.
const RESISTANCE = 0.4;
// Caps the stretch so a long, fast drag doesn't pull the page absurdly far.
const MAX_PULL_PX = 96;
const SPRING_BACK_MS = 320;
// Chromium keeps its inertial scroll after touchend but does not expose the
// unused momentum once it clamps at an edge. A recent, sufficiently fast
// finger velocity lets us synthesize a smaller continuation when that fling
// reaches the boundary shortly afterward.
const MIN_FLING_VELOCITY_PX_MS = 0.35;
const FLING_MAX_AGE_MS = 1_600;
const FLING_LIFT_GRACE_MS = 120;
const FLING_OUT_MS = 90;
const MIN_FLING_PULL_PX = 12;
const MAX_FLING_PULL_PX = 32;
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
// Routes that expose a dedicated `[data-rubber-band-surface]` move that
// surface with a compositor-friendly transform, leaving shared fixed chrome
// outside it. Other routes retain the safe <body> `position: relative` +
// `top` fallback below.
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
// mobile-feel feature. Chromium does not expose the overscroll portion of a
// finger-up fling, so that path is deliberately a smaller velocity-based
// approximation; the normal finger-down pull remains exact.
interface DragState {
  edge: "top" | "bottom";
  // Whether we've taken the gesture over from native scrolling.
  active: boolean;
  // Previous touchmove's Y — arming keys off movement *since the last move*,
  // not since touchstart, so a gesture that scrolls the page all the way to
  // an edge and then reverses doesn't count its own earlier travel as pull.
  lastY: number;
  lastMoveAt: number;
  // Smoothed finger velocity. Positive travels toward the top edge; negative
  // travels toward the bottom edge.
  velocityPxMs: number;
  // Y at the exact moment this gesture armed. The pull is measured from
  // here, not from touchstart, so reaching the bottom edge halfway through
  // an already-long drag starts the stretch at 0 and grows with however much
  // further the finger travels past the boundary — rather than jumping
  // straight to full stretch because the whole gesture's delta was already
  // larger than MAX_PULL_PX.
  armedAtY: number;
  // The nearest real scrollable ancestor of the touch's start element, if
  // any — null means the touch started somewhere that only the document
  // itself can scroll (e.g. Dashboard). Screens like WizardShell scroll an
  // inner `overflow-y-auto` `main` instead of the document, so `window`'s
  // own scrollY/scrollHeight stay at 0 the entire time; arming off those
  // made the hook think it was already at the bottom on the very first
  // upward swipe (0 >= 0 - epsilon), preventDefault-ing the gesture before
  // the inner container ever got to scroll — the reported symptom was a
  // wizard step whose content simply couldn't be scrolled into view at all.
  scrollEl: Element | null;
  // Whether this gesture's touchmove listener was registered non-passive
  // (able to preventDefault) — decided once, at touchstart, from whether
  // the touch already rests at a scroll boundary. See attachTouchMove's own
  // comment for why that's the only case worth paying the blocking-listener
  // cost for.
  blocking: boolean;
}

interface FlingState {
  edge: "top" | "bottom";
  scrollEl: Element | null;
  speedPxMs: number;
  expiresAt: number;
}

function isRealScrollContainer(el: Element): boolean {
  const style = getComputedStyle(el);
  return (style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
}

// Walks up from the touch's start element looking for whatever actually
// scrolls under the finger — stops before body/documentElement since the
// window-level fallback already covers that case.
function findScrollableAncestor(el: Element): Element | null {
  let node: Element | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    if (isRealScrollContainer(node)) return node;
    node = node.parentElement;
  }
  return null;
}

export function useRubberBandScroll() {
  useEffect(() => {
    let drag: DragState | null = null;
    let fling: FlingState | null = null;
    let springTimer = 0;
    let flingTimer = 0;
    let flingOutTimer = 0;
    let flingFrame = 0;
    let pullFrame = 0;
    let pendingPullOffset = 0;
    let movementSurface: HTMLElement = document.body;
    // Whether the currently-registered touchmove listener is non-passive.
    // Re-registered per gesture (see attachTouchMove) rather than fixed once
    // at mount, since a non-passive listener forces Chromium to run this
    // handler on the main thread before it can scroll *every* touchmove of
    // *every* gesture on *every* screen — not just the ones that actually
    // end up pulling. Most scrolling never gets anywhere near an edge, so
    // paying that cost unconditionally was a real, measurable source of
    // scroll jank on ordinary lists (e.g. the food log).
    let touchMoveBlocking = false;
    let touchMoveAttached = false;

    function maxScroll() {
      return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    }

    function scrollBoundary(scrollEl: Element | null) {
      const scrollTop = scrollEl ? scrollEl.scrollTop : window.scrollY;
      const scrollMax = scrollEl ? scrollEl.scrollHeight - scrollEl.clientHeight : maxScroll();
      return { scrollTop, scrollMax };
    }

    // A gesture can only ever need preventDefault if it's already resting at
    // a boundary when it starts — pulling further is the very first move,
    // before any native scroll for this touch has happened, so it's still
    // reliably cancelable. A gesture that starts mid-list and scrolls all
    // the way to an edge within one continuous touch can still arm (see
    // onTouchMove) and still renders its own offset correctly, but by then
    // Chromium has already begun scrolling this gesture natively and
    // preventDefault is a documented no-op regardless of listener
    // passive-ness — so registering non-passive for every gesture bought
    // that case nothing, while costing every other gesture main-thread
    // scrolling. Attaching non-passive only when it can actually matter
    // keeps the rest of scrolling on the fast compositor path.
    function attachTouchMove(blocking: boolean) {
      if (touchMoveAttached && blocking === touchMoveBlocking) return;
      if (touchMoveAttached) window.removeEventListener("touchmove", onTouchMove);
      touchMoveBlocking = blocking;
      window.addEventListener("touchmove", onTouchMove, { passive: !blocking });
      touchMoveAttached = true;
    }

    function detachTouchMove() {
      if (!touchMoveAttached) return;
      window.removeEventListener("touchmove", onTouchMove);
      touchMoveAttached = false;
    }

    // px > 0 pushes the page down (top-edge pull), px < 0 lifts it up
    // (bottom-edge pull).
    function setOffset(px: number) {
      if (movementSurface === document.body) {
        document.body.style.position = "relative";
        document.body.style.willChange = "top";
        document.body.style.top = `${px}px`;
        return;
      }
      movementSurface.style.willChange = "transform";
      movementSurface.style.transform = `translate3d(0, ${px}px, 0)`;
    }

    function setOffsetTransition(value: string) {
      const transition = !value || value === "none"
        ? value
        : `${movementSurface === document.body ? "top" : "transform"} ${value}`;
      if (movementSurface === document.body) {
        document.body.style.transition = transition;
      } else {
        movementSurface.style.transition = transition;
      }
    }

    // Touch hardware can deliver more move events than the display can paint.
    // Keep preventDefault() in the event itself, but collapse visual writes to
    // at most one per animation frame so repeated body positioning cannot do
    // redundant main-thread work between two visible frames.
    function schedulePullOffset(px: number) {
      pendingPullOffset = px;
      if (pullFrame) return;
      pullFrame = window.requestAnimationFrame(() => {
        pullFrame = 0;
        setOffsetTransition("none");
        setOffset(pendingPullOffset);
      });
    }

    function cancelPullFrame() {
      window.cancelAnimationFrame(pullFrame);
      pullFrame = 0;
    }

    function clearOffset() {
      window.clearTimeout(springTimer);
      window.clearTimeout(flingOutTimer);
      window.cancelAnimationFrame(flingFrame);
      cancelPullFrame();
      if (movementSurface === document.body) {
        document.body.style.transition = "";
        document.body.style.top = "";
        document.body.style.position = "";
        document.body.style.willChange = "";
      } else {
        movementSurface.style.transition = "";
        movementSurface.style.transform = "";
        movementSurface.style.willChange = "";
      }
    }

    function clearFling() {
      fling = null;
      window.clearTimeout(flingTimer);
    }

    function springBack() {
      cancelPullFrame();
      setOffsetTransition(`${SPRING_BACK_MS}ms cubic-bezier(0.2, 0, 0, 1)`);
      setOffset(0);
      window.clearTimeout(springTimer);
      springTimer = window.setTimeout(clearOffset, SPRING_BACK_MS);
    }

    function startFlingBounce(edge: "top" | "bottom", speedPxMs: number) {
      clearFling();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) return;

      const pull = Math.min(MAX_FLING_PULL_PX, MIN_FLING_PULL_PX + speedPxMs * 8);
      clearOffset();
      setOffset(0);
      setOffsetTransition("none");
      flingFrame = window.requestAnimationFrame(() => {
        setOffsetTransition(`${FLING_OUT_MS}ms cubic-bezier(0.2, 0, 0.2, 1)`);
        setOffset(edge === "top" ? pull : -pull);
        flingOutTimer = window.setTimeout(springBack, FLING_OUT_MS);
      });
    }

    function maybeBounceFling() {
      if (!fling) return;
      if (performance.now() > fling.expiresAt || (fling.scrollEl && !fling.scrollEl.isConnected)) {
        clearFling();
        return;
      }

      const scrollTop = fling.scrollEl ? fling.scrollEl.scrollTop : window.scrollY;
      const scrollMax = fling.scrollEl
        ? fling.scrollEl.scrollHeight - fling.scrollEl.clientHeight
        : maxScroll();
      const atEdge = fling.edge === "top"
        ? scrollTop <= 0
        : scrollTop >= scrollMax - BOTTOM_EPSILON_PX;
      if (atEdge) startFlingBounce(fling.edge, fling.speedPxMs);
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
      clearFling();
      clearOffset();
      movementSurface = e.target instanceof Element
        ? e.target.closest<HTMLElement>("[data-rubber-band-surface]") ?? document.body
        : document.body;
      const y = e.touches[0].clientY;
      const scrollEl = e.target instanceof Element ? findScrollableAncestor(e.target) : null;
      const { scrollTop, scrollMax } = scrollBoundary(scrollEl);
      const blocking = scrollTop <= 0 || scrollTop >= scrollMax - BOTTOM_EPSILON_PX;
      attachTouchMove(blocking);
      drag = {
        edge: "top",
        active: false,
        lastY: y,
        lastMoveAt: performance.now(),
        velocityPxMs: 0,
        armedAtY: y,
        scrollEl,
        blocking,
      };
    }

    function onTouchMove(e: TouchEvent) {
      if (!drag || e.touches.length !== 1) return;
      const currentY = e.touches[0].clientY;
      const moveDelta = currentY - drag.lastY;
      const now = performance.now();
      const elapsed = Math.max(1, now - drag.lastMoveAt);
      const instantaneousVelocity = moveDelta / elapsed;
      drag.velocityPxMs = drag.velocityPxMs * 0.55 + instantaneousVelocity * 0.45;
      drag.lastY = currentY;
      drag.lastMoveAt = now;

      if (!drag.active) {
        // Measured against the touch's own scrollable ancestor when it has
        // one (e.g. WizardShell's inner `main`), not always window/document
        // — otherwise a container that scrolls independently of the page
        // reads as permanently "at the boundary" (window never moves), and
        // arms a bounce instead of letting the container's native scroll
        // run.
        const { scrollTop, scrollMax } = scrollBoundary(drag.scrollEl);
        // Arms only while the finger is moving in the pull direction *and*
        // we're already sitting at that boundary — never mid-scroll, so a
        // normal scroll gesture keeps its native handling (momentum,
        // performance, all of it) right up until it genuinely runs out of
        // content.
        if (moveDelta > 0 && scrollTop <= 0) {
          drag.edge = "top";
        } else if (moveDelta < 0 && scrollTop >= scrollMax - BOTTOM_EPSILON_PX) {
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
      schedulePullOffset(drag.edge === "top" ? pull : -pull);
      // Only once we're actually mid-pull, and only if this gesture's
      // listener was registered non-passive in the first place — calling
      // preventDefault from inside a passive invocation just logs a console
      // warning and does nothing. Guarded on `cancelable` too, because a
      // gesture that reached the bottom edge *after* native scrolling had
      // already begun is no longer cancelable in Chromium even when
      // blocking; the offset above still renders correctly there, this call
      // would just log a console warning for nothing.
      if (drag.blocking && e.cancelable) e.preventDefault();
    }

    function onTouchEnd() {
      if (drag?.active) {
        springBack();
      } else if (
        drag
        && performance.now() - drag.lastMoveAt <= FLING_LIFT_GRACE_MS
        && Math.abs(drag.velocityPxMs) >= MIN_FLING_VELOCITY_PX_MS
      ) {
        fling = {
          edge: drag.velocityPxMs > 0 ? "top" : "bottom",
          scrollEl: drag.scrollEl,
          speedPxMs: Math.abs(drag.velocityPxMs),
          expiresAt: performance.now() + FLING_MAX_AGE_MS,
        };
        window.clearTimeout(flingTimer);
        flingTimer = window.setTimeout(clearFling, FLING_MAX_AGE_MS);
        // Handles a lift that occurs on the same frame native scrolling
        // reaches the boundary; later inertial positions arrive via scroll.
        maybeBounceFling();
      }
      drag = null;
      detachTouchMove();
    }

    function onTouchCancel() {
      if (drag?.active) springBack();
      drag = null;
      clearFling();
      detachTouchMove();
    }

    function onScroll(e: Event) {
      if (!fling) return;
      if (fling.scrollEl) {
        if (e.target !== fling.scrollEl) return;
      } else if (e.target !== document && e.target !== document.documentElement && e.target !== window) {
        return;
      }
      maybeBounceFling();
    }

    // touchmove itself is attached per-gesture by onTouchStart (see
    // attachTouchMove) rather than statically here, so its passive-ness can
    // vary per gesture.
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      detachTouchMove();
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
      window.removeEventListener("scroll", onScroll, true);
      clearFling();
      clearOffset();
    };
  }, []);
}
