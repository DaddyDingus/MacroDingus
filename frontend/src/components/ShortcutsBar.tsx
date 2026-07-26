import { useEffect, useState } from "react";
import { SHORTCUT_CATALOG, useDashboardShortcuts, type ShortcutId } from "../lib/shortcuts";
import useHideOnScroll from "../lib/useHideOnScroll";
import QuickActionFlow from "./QuickActionFlow";

// Floats above BottomNav on the Dashboard only — the FAB already offers the
// same actions on every other screen, so this isn't global chrome, just a
// repositioned/animated version of what used to be an inline grid in
// DashboardScreen's body.
export default function ShortcutsBar() {
  const { shortcuts } = useDashboardShortcuts();
  const [runningAction, setRunningAction] = useState<ShortcutId | null>(null);
  const visible = useHideOnScroll();
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

  return (
    <>
      <div
        className={`fixed inset-x-0 z-30 px-4 pb-3 transition-[transform,opacity] duration-200 ease-out ${
          visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 pointer-events-none"
        }`}
        style={{ bottom: navHeight }}
      >
        <div className="max-w-md mx-auto grid grid-cols-4 gap-2">
          {shortcuts.map((id) => {
            const s = SHORTCUT_CATALOG.find((c) => c.id === id);
            if (!s) return null;
            return (
              <button
                key={id}
                onClick={() => setRunningAction(id)}
                className="border border-line bg-surface rounded-md py-3 px-1 text-center shadow-lg shadow-black/20 active:bg-surface-raised"
              >
                <span className="block text-xs leading-tight">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {runningAction && <QuickActionFlow action={runningAction} onClose={() => setRunningAction(null)} />}
    </>
  );
}
