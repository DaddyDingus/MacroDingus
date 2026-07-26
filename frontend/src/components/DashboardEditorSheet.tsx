import { CATEGORIES, TILE_CATALOG, useDashboardLayout } from "../lib/dashboardLayout";

// Visual pattern matches QuickActionsSheet's "Edit shortcuts" checklist —
// same circle-toggle rows. Enabled tiles are listed first, in their current
// order, with up/down arrows to reorder within the category only; disabled
// tiles follow, toggle-only (nothing to reorder if it isn't shown).
export default function DashboardEditorSheet({ onClose }: { onClose: () => void }) {
  const { layout, toggle, move } = useDashboardLayout();

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] flex flex-col bg-surface rounded-t-xl border-t border-line pb-[env(safe-area-inset-bottom)]">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
          <span className="text-sm font-medium">Customise dashboard</span>
          <button onClick={onClose} className="text-xs text-accent">
            Done
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-4">
          {CATEGORIES.map((cat) => {
            const catalogForCat = TILE_CATALOG.filter((t) => t.category === cat.id);
            const enabledOrder = layout[cat.id];
            const enabledTiles = enabledOrder
              .map((id) => catalogForCat.find((t) => t.id === id))
              .filter((t): t is (typeof catalogForCat)[number] => t !== undefined);
            const disabledTiles = catalogForCat.filter((t) => !enabledOrder.includes(t.id));

            return (
              <div key={cat.id} className="pt-3">
                <p className="px-4 pb-1 text-[11px] tracking-widest uppercase text-muted">{cat.label}</p>

                {enabledTiles.map((t, i) => (
                  <div key={t.id} className="w-full flex items-center justify-between px-4 py-2.5 border-b border-line/60">
                    <button onClick={() => toggle(cat.id, t.id)} className="flex items-center gap-3 flex-1 text-left">
                      <span className="h-4 w-4 rounded-full border shrink-0 bg-accent border-accent" />
                      <span className="text-sm">{t.label}</span>
                    </button>
                    <span className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => move(cat.id, t.id, "up")}
                        disabled={i === 0}
                        aria-label={`Move ${t.label} up`}
                        className="text-muted disabled:opacity-20 px-1.5 py-1"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => move(cat.id, t.id, "down")}
                        disabled={i === enabledTiles.length - 1}
                        aria-label={`Move ${t.label} down`}
                        className="text-muted disabled:opacity-20 px-1.5 py-1"
                      >
                        ↓
                      </button>
                    </span>
                  </div>
                ))}

                {disabledTiles.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => toggle(cat.id, t.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-line/60 text-left"
                  >
                    <span className="h-4 w-4 rounded-full border border-line shrink-0" />
                    <span className="text-sm text-muted">{t.label}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
