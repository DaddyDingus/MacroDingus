import { useEffect, useRef, useState } from "react";

// Hides the caller on scroll-down, shows it on scroll-up, always shown near
// the top. No scroll-tracking pattern exists elsewhere in this app — this is
// built from scratch, rAF-throttled with a small dead zone so ordinary
// touch-scroll jitter doesn't flicker it.
export default function useHideOnScroll(threshold = 8) {
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

  useEffect(() => {
    function onScroll() {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const y = window.scrollY;
        const delta = y - lastY.current;
        if (y <= threshold) {
          setVisible(true);
        } else if (Math.abs(delta) > threshold) {
          setVisible(delta < 0);
        }
        lastY.current = y;
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
