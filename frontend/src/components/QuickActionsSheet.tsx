import { useState } from "react";
import {
  SHORTCUT_CATALOG,
  SHORTCUT_COLOR_CATALOG,
  MAX_DASHBOARD_SHORTCUTS,
  useDashboardShortcuts,
  type ShortcutId,
} from "../lib/shortcuts";
import QuickActionFlow from "./QuickActionFlow";
import BottomSheet from "./BottomSheet";

// The center nav button and everything it opens: the full quick-actions menu,
// an edit-shortcuts checklist, and (once an action is picked) the shared
// QuickActionFlow that also backs the Dashboard's pinned shortcut buttons.
export default function QuickActionsButton() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex-1 flex items-center justify-center">
      <button
        onClick={() => setOpen(true)}
        aria-label="Quick actions"
        className="h-12 w-12 -translate-y-3 rounded-full bg-white text-black shadow-lg shadow-black/40 ring-1 ring-black/10 flex items-center justify-center text-2xl leading-none active:scale-95 transition-transform"
      >
        +
      </button>
      {open && <QuickActionsSheet onClose={() => setOpen(false)} />}
    </div>
  );
}

function QuickActionsSheet({ onClose }: { onClose: () => void }) {
  const { shortcuts, toggle, colors, setColor } = useDashboardShortcuts();
  const [view, setView] = useState<"menu" | "edit">("menu");
  const [runningAction, setRunningAction] = useState<ShortcutId | null>(null);

  if (runningAction) {
    return <QuickActionFlow action={runningAction} onClose={onClose} />;
  }

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line pb-[env(safe-area-inset-bottom)]"
    >
        {view === "menu" && (
          <>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
              <span className="text-sm font-medium">Quick actions</span>
              <button onClick={onClose} className="text-muted text-xl leading-none px-1">
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pb-2">
              {SHORTCUT_CATALOG.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setRunningAction(s.id)}
                  className="w-full flex items-center px-4 py-3 border-b border-line/60 text-left active:bg-surface-raised text-sm"
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="px-4 py-3 shrink-0 border-t border-line">
              <button onClick={() => setView("edit")} className="text-xs text-accent">
                Edit shortcuts
              </button>
            </div>
          </>
        )}

        {view === "edit" && (
          <>
            <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
              <span className="text-sm font-medium">Edit shortcuts</span>
              <button onClick={() => setView("menu")} className="text-xs text-accent">
                Done
              </button>
            </div>
            <p className="px-4 pb-2 text-xs text-muted shrink-0">
              Pick up to {MAX_DASHBOARD_SHORTCUTS} — these show as buttons on your Dashboard.
            </p>
            <div className="flex-1 overflow-y-auto pb-4">
              {SHORTCUT_CATALOG.map((s) => {
                const selected = shortcuts.includes(s.id);
                const disabled = !selected && shortcuts.length >= MAX_DASHBOARD_SHORTCUTS;
                const colorId = colors[s.id] ?? "default";
                return (
                  <div key={s.id} className="border-b border-line/60">
                    <button
                      onClick={() => toggle(s.id)}
                      disabled={disabled}
                      className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-surface-raised disabled:opacity-30"
                    >
                      <span className="text-sm">{s.label}</span>
                      <span
                        className={`h-4 w-4 rounded-full border shrink-0 ${
                          selected ? "bg-accent border-accent" : "border-line"
                        }`}
                      />
                    </button>
                    {selected && (
                      <div className="px-4 pb-3 flex items-center gap-2.5">
                        {SHORTCUT_COLOR_CATALOG.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setColor(s.id, c.id)}
                            aria-label={c.label}
                            className={`h-6 w-6 rounded-full shrink-0 border-2 transition ${
                              colorId === c.id ? "border-white" : "border-transparent"
                            }`}
                            style={{ backgroundColor: c.hex }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
    </BottomSheet>
  );
}
