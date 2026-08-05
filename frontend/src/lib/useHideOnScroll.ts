import { useEffect, useRef, useState } from "react";
import { useNavVisibility } from "./navVisibility";

// Hides the caller on scroll-down, shows it on scroll-up, always shown near
// the top. No scroll-tracking pattern exists elsewhere in this app — this is
// built from scratch, rAF-throttled with a small dead zone so ordinary
// touch-scroll jitter doesn't flicker it.
export default function useHideOnScroll(threshold = 8) {
  const { isScrollHideSuppressed } = useNavVisibility();
  // Always starts visible rather than reading window.scrollY at mount:
  // ShortcutsBar (this hook's only caller) used to be mounted fresh by every
  // screen that rendered it, and its initial render happened before
  // AppRoutes' own scroll-to-top layout effect ran — reading scrollY here
  // could pick up the *previous* screen's position and mount already
  // hidden, only to pop back visible a frame later. ShortcutsBar is now
  // rendered once by App.tsx (see its own comment) so this can no longer
  // happen via a remount, but starting visible is still the simplest
  // correct default regardless.
  const [visible, setVisible] = useState(true);
  const lastY = useRef(typeof window !== "undefined" ? window.scrollY : 0);
  const frame = useRef<number | null>(null);
  // A delta's sign that cleared the threshold but hasn't been trusted yet —
  // a plain jitter guard against a single stray sample, cheap insurance on
  // top of isScrollHideSuppressed above. It alone can't catch a *sustained*
  // multi-frame scrollY correction (an animated layout shift can clamp
  // scrollY once per frame for its whole transition, which looks exactly
  // like a real multi-frame scroll gesture by direction/consistency alone)
  // — that's what suppression is for; this only covers a genuinely isolated
  // one-off blip.
  const pendingSign = useRef(0);

  useEffect(() => {
    function onScroll() {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const y = window.scrollY;
        const delta = y - lastY.current;
        // Always resynced, even while suppressed — so the first sample once
        // suppression lifts measures against wherever the page actually
        // settled, not a stale pre-transition position (which would read as
        // one large spurious delta the instant suppression ends).
        lastY.current = y;
        if (isScrollHideSuppressed()) {
          pendingSign.current = 0;
          return;
        }
        if (y <= threshold) {
          setVisible(true);
          pendingSign.current = 0;
          return;
        }
        if (Math.abs(delta) <= threshold) return;
        const sign = delta < 0 ? 1 : -1;
        if (pendingSign.current === sign) {
          setVisible(delta < 0);
          pendingSign.current = 0;
        } else {
          pendingSign.current = sign;
        }
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [threshold]);

  return visible;
}
