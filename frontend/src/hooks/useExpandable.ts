import { useEffect, useRef, useState } from "react";

// How long the scroll-into-view takes, regardless of how far it has to
// travel. Native `scrollIntoView({behavior:"smooth"})` scales its duration
// with distance instead, which is what made the *first* expand of a section
// feel sluggish while every consecutive one felt instant: the first tap
// scrolls the full way up the page (measured ~660ms of scrolling for a
// ~1400px trip on a throttled phone profile), and once you're already
// parked at the section, re-expanding travels ~0px and finishes
// immediately. Same code, same animation — only the distance differed.
// A fixed duration makes near and far expands feel identical.
const SCROLL_MS = 300;

// Shared expand/collapse behavior for every accordion-style section in the
// app (MonthSection, the History show/hide card, Top Contributors, Steps'
// Recent days): bring the section's header to the top of the viewport when
// it expands.
export function useExpandable(defaultOpen = false) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  function cancelScroll() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  useEffect(() => cancelScroll, []);

  function scrollSectionToTop() {
    const el = ref.current;
    if (!el) return;
    cancelScroll();

    const settle = () => {
      // Recomputed per frame rather than measured once up front: this runs
      // *during* the 0fr->1fr expand, so the page is still growing and the
      // section is still moving. Clamping to the live max scroll is also
      // what makes the common "section is the last thing on the page" case
      // work — there isn't yet room to put it at the top when the finger
      // lifts, and there is by the time the content finishes opening.
      const target = window.scrollY + el.getBoundingClientRect().top;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return Math.max(0, Math.min(target, max));
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.scrollTo(0, settle());
      return;
    }

    const from = window.scrollY;
    const startedAt = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - startedAt) / SCROLL_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      window.scrollTo(0, from + (settle() - from) * eased);
      rafRef.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    rafRef.current = requestAnimationFrame(step);
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // Started on the same tick as the state change, deliberately not waited
    // on the expand's `transitionend` — serializing them stacked the scroll
    // *after* the 150ms animation for no benefit, since `settle()` above
    // already tolerates the page being mid-growth.
    if (next) scrollSectionToTop();
  }

  // A touch or wheel mid-flight means the user is scrolling themselves;
  // never fight them for the scroll position.
  useEffect(() => {
    if (rafRef.current === null) return;
    window.addEventListener("touchstart", cancelScroll, { passive: true });
    window.addEventListener("wheel", cancelScroll, { passive: true });
    return () => {
      window.removeEventListener("touchstart", cancelScroll);
      window.removeEventListener("wheel", cancelScroll);
    };
  });

  return { open, toggle, ref };
}
