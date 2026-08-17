import { useEffect, useState } from "react";

// Tracks #app-bottom-nav's real rendered height via ResizeObserver, so a
// floating element above it can sit flush against it in a `bottom` style
// rather than guessing/hardcoding an offset. Shared by ShortcutsBar and
// LogActionBar — both float directly above BottomNav.
//
// BottomNav is not a permanent DOM node: it returns null on the Strategy
// wizard routes and for every overlay that opts into useHideBottomNav (the
// weekly CheckInFlow, the photo aligner/lightbox), then renders a *brand new*
// element when that overlay closes. Two consequences this hook has to survive,
// both of which used to leave the docked bar permanently invisible until a
// reload (found 2026-08-17, reproduced headlessly: Chrome reports 0×0 for an
// observed element the moment it's detached):
//   1. The 0 that arrives on unmount is "the nav isn't rendered", not "the nav
//      is zero tall" — latching it moved ShortcutsBar to bottom: 0, i.e.
//      underneath the opaque nav (z-30 vs z-40). Zero is ignored; the last
//      real height is held instead, which is also the right value for the
//      nav that comes back.
//   2. The observer stayed pointed at the detached node forever, so the
//      replacement was never measured. The node is re-resolved whenever the
//      one we hold leaves the document.
export default function useBottomNavHeight(): number {
  const [navHeight, setNavHeight] = useState(0);

  useEffect(() => {
    let observed: HTMLElement | null = null;
    // Keep the fractional CSS-pixel height. offsetHeight rounds to an integer,
    // which can leave a hairline gap above the nav at some device pixel ratios.
    const measure = () => {
      if (!observed?.isConnected) return;
      const height = observed.getBoundingClientRect().height;
      if (height > 0) setNavHeight(height);
    };
    const observer = new ResizeObserver(measure);

    const attach = () => {
      // Cheap enough to run on every DOM mutation in the app: once we hold a
      // live node this is a single boolean, and a lookup only happens across
      // the handful of frames where the nav is genuinely absent.
      if (observed?.isConnected) return;
      const nav = document.getElementById("app-bottom-nav");
      if (!nav) return;
      if (observed) observer.unobserve(observed);
      observed = nav;
      observer.observe(nav);
      measure();
    };
    attach();

    const mutations = new MutationObserver(attach);
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);

  return navHeight;
}
