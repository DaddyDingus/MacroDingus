import { useEffect, useState } from "react";
import { SHORTCUT_CATALOG, SHORTCUT_COLOR_CATALOG, useDashboardShortcuts, type ShortcutId } from "../lib/shortcuts";
import useHideOnScroll from "../lib/useHideOnScroll";
import QuickActionFlow from "./QuickActionFlow";

// Floats above BottomNav on the Dashboard only — the FAB already offers the
// same actions on every other screen, so this isn't global chrome, just a
// repositioned/animated version of what used to be an inline grid in
// DashboardScreen's body.
export default function ShortcutsBar() {
  const { shortcuts, colors } = useDashboardShortcuts();
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
        className={`fixed inset-x-0 z-30 transition-[transform,opacity] duration-200 ease-out ${
          visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 pointer-events-none"
        }`}
        style={{ bottom: navHeight }}
      >
        <div className="bg-dashboardBg flex">
          {shortcuts.map((id) => {
            const s = SHORTCUT_CATALOG.find((c) => c.id === id);
            if (!s) return null;
            const Icon = s.icon;
            const colorId = colors[id] ?? "default";
            const color = SHORTCUT_COLOR_CATALOG.find((c) => c.id === colorId) ?? SHORTCUT_COLOR_CATALOG[0];
            return (
              <button
                key={id}
                onClick={() => setRunningAction(id)}
                aria-label={s.label}
                className="flex-1 py-2.5 flex items-center justify-center active:brightness-110 transition"
              >
                <span
                  className="h-10 w-16 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: color.hex }}
                >
                  <Icon size={18} strokeWidth={2} className={color.icon === "black" ? "text-black" : "text-white"} />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {runningAction && <QuickActionFlow action={runningAction} onClose={() => setRunningAction(null)} />}
    </>
  );
}
