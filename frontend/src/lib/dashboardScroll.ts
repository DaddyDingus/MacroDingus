// Module-level (not React state) so it survives DashboardScreen's own
// unmount/remount — every navigation remounts it fresh (see App.tsx's
// `key={location.key}` on the routed content wrapper), so a plain ref/state
// inside the component itself would never carry a value between visits.
let savedScrollY = 0;
let restoreInFlight = false;

export function saveDashboardScroll(y: number): void {
  // A restore is still settling. Every scrollTo it makes fires a scroll
  // event, and any of those the browser clamps short (because the page isn't
  // tall enough yet) would record a position that overwrites the very value
  // being restored.
  if (restoreInFlight) return;
  // The document isn't scrollable at this instant, so scrollY can only be 0
  // and it means nothing. This is exactly the state the page is in the
  // moment the outgoing route's DOM is swapped for an empty
  // `<Suspense fallback={null}>`: the document collapses to viewport height
  // and the browser clamps scrollY to 0. Recording that wipes the real
  // position — see DashboardScreen's capture effect for the full story.
  if (document.documentElement.scrollHeight <= window.innerHeight + 1) return;
  savedScrollY = y;
}

export function getSavedDashboardScroll(): number {
  return savedScrollY;
}

export function setDashboardRestoreInFlight(value: boolean): void {
  restoreInFlight = value;
}

// Independent "was the current location reached via a real back/forward
// navigation" tracker — deliberately not react-router's own
// useNavigationType(). That hook reflects react-router's *own* internal
// bookkeeping, which useBackDismiss's sheets were found to be corrupting
// (see that file's own comment) by overwriting history.state wholesale
// instead of merging with it; that's fixed now, but this app has already
// been wrong twice trusting that bookkeeping was reliable, so this sidesteps
// it entirely rather than trusting it a third time.
//
// The key trick: a real route change (react-router's navigate()) always
// changes window.location.pathname; useBackDismiss's own dummy history
// entries never do (they omit the URL argument to pushState, so the
// pathname is untouched — only history.state changes). Listening for
// popstate and checking whether the pathname actually differs from before
// is therefore a reliable, first-principles way to tell "a real back/forward
// navigation to a different route just happened" apart from "some sheet's
// dummy entry got popped," using nothing but raw browser APIs neither
// react-router nor useBackDismiss can desync.
let previousPathname = typeof window !== "undefined" ? window.location.pathname : "/";
// Both ends of the pop are kept, not just the destination — where we came
// *from* is what separates "backed out of a tile" from "backed out of
// another tab" (see BOTTOM_NAV_ROOTS below).
let pendingPop: { from: string; to: string } | null = null;
// Memoizes the answer for one location.key, so asking twice about the same
// navigation agrees with itself (React StrictMode runs every effect twice in
// dev; without this the first call consumed the pop and the second answered
// "no", scrolling to the top).
let lastResolved: { key: string; restore: boolean } | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    const newPathname = window.location.pathname;
    if (newPathname !== previousPathname) {
      pendingPop = { from: previousPathname, to: newPathname };
    }
    previousPathname = newPathname;
  });
}

// The bottom nav's own tab roots. Landing on the Dashboard from one of these
// is a tab switch, and a tab switch always starts at the top — including when
// it happens via the back gesture rather than a tap, which is the only reason
// the origin has to be checked at all (a tap is a push and wouldn't reach the
// restore path anyway). Only their *roots* are listed: "/strategy/new-goal"
// and friends are opened from a Dashboard tile, so backing out of one should
// restore exactly like any other tile.
const BOTTOM_NAV_ROOTS = new Set(["/", "/log", "/strategy", "/more"]);

// Must be called for every route change the app makes, not just popstates —
// `previousPathname` is what the popstate handler above diffs against, and a
// forward navigation (navigate('/weight')) fires no popstate at all. Without
// this it stayed pinned to whatever the pathname was at page load, so the
// back press out of a tile compared "/" against a stale "/" , saw no
// difference, and never flagged the navigation as a back at all — which is
// why the Dashboard's scroll position was never actually restored.
export function noteNavigation(pathname: string): void {
  previousPathname = pathname;
}

// True only for the one case the saved position is wanted: the Dashboard,
// returned to from a screen it launched (a tile's detail page). A pending pop
// is checked *before* the memo so that a second, different back-navigation
// landing on the same history entry (same location.key) is judged on its own
// origin rather than inheriting the earlier answer.
export function shouldRestoreDashboardScroll(pathname: string, key: string): boolean {
  if (pathname !== "/") return false;
  if (pendingPop && pendingPop.to === pathname) {
    const restore = !BOTTOM_NAV_ROOTS.has(pendingPop.from);
    pendingPop = null;
    lastResolved = { key, restore };
    return restore;
  }
  if (lastResolved && lastResolved.key === key) return lastResolved.restore;
  // No pop at all — a push (a nav-bar tap, or the app's first paint). Always
  // starts at the top.
  return false;
}
