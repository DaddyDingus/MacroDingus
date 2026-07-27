import { useEffect, useState } from "react";

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
export function useVisualViewportMetrics(): VisualViewportMetrics {
  const [metrics, setMetrics] = useState<VisualViewportMetrics>(() => ({
    height: typeof window !== "undefined" ? window.innerHeight : 0,
    offsetTop: 0,
  }));

  useEffect(() => {
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
