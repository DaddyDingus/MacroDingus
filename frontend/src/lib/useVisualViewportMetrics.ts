import { useLayoutEffect, useState } from "react";

export interface VisualViewportMetrics {
  height: number;
  offsetTop: number;
}

// iOS Safari pans the *visual* viewport independently of the layout
// viewport when the on-screen keyboard opens — `position: fixed` elements
// stay put relative to the layout viewport (which doesn't shrink), so they
// silently end up positioned outside what's actually visible on screen. The
// `100dvh` unit doesn't reliably help either; some WebKit versions don't
// recompute it for the software keyboard at all. Tracking
// `window.visualViewport` directly and sizing/positioning fixed overlays
// against it is the standard fix. Falls back to the static window height
// (never updates) in browsers without the VisualViewport API — a rare case
// this app doesn't need to support perfectly.
//
// A debounced version of this was tried (waiting for resize/scroll events to
// stop firing for ~80ms before committing, to avoid applying several
// intermediate keyboard-animation values in a row) — it made things worse,
// not better: (1) real device keyboards can fire two resize events spaced
// further apart than the debounce window, so instead of many small snaps it
// produced two large, clearly-visible opposite-direction jumps; and (2) tab
// switches inside AddFoodSheet change React state (mount/unmount) instantly,
// but the debounced height lagged ~80ms behind that, so for a brief window
// the new tab's content rendered inside a panel still sized for the old
// keyboard state — small enough, in the wrong direction, to momentarily
// expose Layer 1 (the plate view) behind it. Reverted to applying every
// event immediately, keeping this hook's own state in lockstep with
// everything else that changes synchronously (like a tab switch).
export function useVisualViewportMetrics(): VisualViewportMetrics {
  const [metrics, setMetrics] = useState<VisualViewportMetrics>(() => ({
    height: typeof window !== "undefined" ? window.innerHeight : 0,
    offsetTop: 0,
  }));

  // useLayoutEffect, not useEffect — this corrects the initial window.innerHeight
  // guess to the real visualViewport.height synchronously before paint, same
  // reasoning as AddFoodSheet's own header/action-bar height measurements:
  // consumers of this hook (AddFoodSheet's full-screen modal, BottomSheet)
  // animate height/position off these values, so a post-paint correction
  // would animate away from a briefly-wrong first frame instead of never
  // rendering it at all.
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function update() {
      setMetrics({ height: vv!.height, offsetTop: vv!.offsetTop });
    }
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return metrics;
}
