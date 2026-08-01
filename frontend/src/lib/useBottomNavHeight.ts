import { useEffect, useState } from "react";

// Tracks #app-bottom-nav's real rendered height via ResizeObserver, so a
// floating element above it can sit flush against it in a `bottom` style
// rather than guessing/hardcoding an offset. Shared by ShortcutsBar and
// LogActionBar — both float directly above BottomNav.
export default function useBottomNavHeight(): number {
  const [navHeight, setNavHeight] = useState(0);

  useEffect(() => {
    const nav = document.getElementById("app-bottom-nav");
    if (!nav) return;
    const update = () => setNavHeight(nav.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  return navHeight;
}
