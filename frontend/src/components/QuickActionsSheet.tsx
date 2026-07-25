import { useState } from "react";
import { SHORTCUT_CATALOG, MAX_DASHBOARD_SHORTCUTS, useDashboardShortcuts, type ShortcutId } from "../lib/shortcuts";
import QuickActionFlow from "./QuickActionFlow";

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
        className="h-12 w-12 -translate-y-3 rounded-full bg-accent shadow-lg shadow-black/30 flex items-center justify-center text-2xl leading-none active:scale-95 transition-transform"
        style={{ color: "#0B1210" }}
      >
        +
      </button>
      {open && <QuickActionsSheet onClose={() => setOpen(false)} />}
    </div>
  );
}

function QuickActionsSheet({ onClose }: { onClose: () => void }) {
  const { shortcuts, toggle } = useDashboardShortcuts();
  const [view, setView] = useState<"menu" | "edit">("menu");
  const [runningAction, setRunningAction] = useState<ShortcutId | null>(null);

  if (runningAction) {
    return <QuickActionFlow action={runningAction} onClose={onClose} />;
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] flex flex-col bg-surface rounded-t-xl border-t border-line pb-[env(safe-area-inset-bottom)]">
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
                return (
                  <button
                    key={s.id}
                    onClick={() => toggle(s.id)}
                    disabled={disabled}
                    className="w-full flex items-center justify-between px-4 py-3 border-b border-line/60 text-left active:bg-surface-raised disabled:opacity-30"
                  >
                    <span className="text-sm">{s.label}</span>
                    <span
                      className={`h-4 w-4 rounded-full border shrink-0 ${
                        selected ? "bg-accent border-accent" : "border-line"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
