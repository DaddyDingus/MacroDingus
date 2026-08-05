import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface NavVisibilityContextValue {
  hidden: boolean;
  push: () => void;
  pop: () => void;
  shortcutsHidden: boolean;
  pushShortcuts: () => void;
  popShortcuts: () => void;
  // ShortcutsBar's own scroll-driven visibility (see its useHideOnScroll
  // call), reported up so BottomNav can tell whether a docked bar is
  // actually on screen right now rather than just inferring it from the
  // route — see setDockedBarScrollVisible's own comment.
  dockedBarScrollVisible: boolean;
  setDockedBarScrollVisible: (visible: boolean) => void;
  // Tells every useHideOnScroll instance app-wide to ignore scroll events
  // for the next `ms` — call this immediately before starting any animated
  // layout change that alters real document height (a collapsing sticky
  // header, not a `transform`-only hide like ShortcutsBar's own). A CSS
  // transition isn't instant: it can clamp window.scrollY a little on every
  // frame for its whole duration, which reads to every scroll listener as a
  // real, sustained, multi-frame scroll gesture — indistinguishable from
  // genuine input by direction/consistency alone, and long enough that a
  // "confirm with the next sample" jitter guard doesn't help either. Plain
  // mutable ref rather than state: read synchronously inside a scroll
  // handler, not meant to trigger a render of its own.
  suppressScrollHide: (ms: number) => void;
  isScrollHideSuppressed: () => boolean;
}

const NavVisibilityContext = createContext<NavVisibilityContextValue | null>(null);

export function NavVisibilityProvider({ children }: { children: ReactNode }) {
  const countRef = useRef(0);
  const [hidden, setHidden] = useState(false);
  const shortcutsCountRef = useRef(0);
  const [shortcutsHidden, setShortcutsHidden] = useState(false);
  const [dockedBarScrollVisible, setDockedBarScrollVisible] = useState(true);
  const suppressedUntilRef = useRef(0);

  function push() {
    countRef.current++;
    setHidden(true);
  }
  function pop() {
    countRef.current = Math.max(0, countRef.current - 1);
    setHidden(countRef.current > 0);
  }
  function pushShortcuts() {
    shortcutsCountRef.current++;
    setShortcutsHidden(true);
  }
  function popShortcuts() {
    shortcutsCountRef.current = Math.max(0, shortcutsCountRef.current - 1);
    setShortcutsHidden(shortcutsCountRef.current > 0);
  }
  function suppressScrollHide(ms: number) {
    // max, not overwrite: an overlapping second call (e.g. another toggle
    // before the first transition finished) should extend the window, never
    // shorten it.
    suppressedUntilRef.current = Math.max(suppressedUntilRef.current, performance.now() + ms);
  }
  function isScrollHideSuppressed() {
    return performance.now() < suppressedUntilRef.current;
  }

  return (
    <NavVisibilityContext.Provider
      value={{
        hidden,
        push,
        pop,
        shortcutsHidden,
        pushShortcuts,
        popShortcuts,
        dockedBarScrollVisible,
        setDockedBarScrollVisible,
        suppressScrollHide,
        isScrollHideSuppressed,
      }}
    >
      {children}
    </NavVisibilityContext.Provider>
  );
}

// Counter-based (not a plain boolean) so two overlays opting in at once —
// e.g. the photo lightbox opened from underneath an already-open aligner —
// don't have the first one's unmount flip the nav back on while the second
// is still up.
//
// Routed full-screen takeovers (the Strategy wizard) hide BottomNav with a
// plain pathname check instead, since that's already available for free.
// This hook exists for the other case: a full-screen overlay that's local
// component state, not its own URL (the photo aligner modal, the photo
// lightbox) — same root problem BottomNav's fixed "+" button caused for the
// wizard's CTA (see CLAUDE.md), just without a pathname to key off of.
export function useHideBottomNav(active: boolean) {
  const ctx = useContext(NavVisibilityContext);
  useEffect(() => {
    if (!active || !ctx) return;
    ctx.push();
    return ctx.pop;
  }, [active, ctx]);
}

// Same counter-based reasoning as useHideBottomNav, for the other piece of
// fixed bottom chrome: TodayScreen's multi-select mode swaps ShortcutsBar
// out for LogActionBar in the same slot, without hiding BottomNav itself.
// Needed once ShortcutsBar was lifted to render once in App.tsx (see its own
// comment) instead of being mounted separately by every screen that shows
// it — a screen-local condition like `selection` can no longer just
// conditionally render it away.
export function useHideShortcutsBar(active: boolean) {
  const ctx = useContext(NavVisibilityContext);
  useEffect(() => {
    if (!active || !ctx) return;
    ctx.pushShortcuts();
    return ctx.popShortcuts;
  }, [active, ctx]);
}

export function useNavVisibility() {
  const ctx = useContext(NavVisibilityContext);
  if (!ctx) throw new Error("useNavVisibility must be used within NavVisibilityProvider");
  return ctx;
}
