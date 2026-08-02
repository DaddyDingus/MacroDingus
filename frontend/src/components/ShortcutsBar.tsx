import { useState } from "react";
import { SHORTCUT_CATALOG, SHORTCUT_COLOR_CATALOG, useDashboardShortcuts, type ShortcutId } from "../lib/shortcuts";
import useHideOnScroll from "../lib/useHideOnScroll";
import useBottomNavHeight from "../lib/useBottomNavHeight";
import QuickActionFlow from "./QuickActionFlow";

// Floats above BottomNav on the Dashboard only — the FAB already offers the
// same actions on every other screen, so this isn't global chrome, just a
// repositioned/animated version of what used to be an inline grid in
// DashboardScreen's body.
export default function ShortcutsBar() {
  const { shortcuts, colors } = useDashboardShortcuts();
  const [runningAction, setRunningAction] = useState<ShortcutId | null>(null);
  const visible = useHideOnScroll();
  const navHeight = useBottomNavHeight();

  return (
    <>
      <div
        className={`fixed inset-x-0 z-30 transition-transform duration-200 ease-out ${
          visible ? "translate-y-0" : "translate-y-full pointer-events-none"
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
                <span className="h-10 w-16 rounded-full bg-dashboardChip flex items-center justify-center">
                  <Icon
                    size={18}
                    strokeWidth={2}
                    style={colorId !== "default" ? { color: color.hex } : undefined}
                    className={colorId === "default" ? "text-white" : ""}
                  />
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
