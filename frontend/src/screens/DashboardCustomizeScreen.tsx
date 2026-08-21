import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GripVertical } from "lucide-react";
import { CATEGORIES, TILE_CATALOG, useDashboardLayout, type Category, type TileId } from "../lib/dashboardLayout";
import { TILE_ICONS } from "../lib/tileIcons";
import AddTilesSheet from "../components/AddTilesSheet";
import { useDragReorder } from "../hooks/useDragReorder";

// Its own screen (not a bottom sheet) reached from the Dashboard's "Customise
// dashboard" tile — back out via the bottom nav's Dashboard tab, same as
// every other tile-drill-down screen in this app (none of them have their
// own back arrow either).
//
// Reordering is a hand-rolled pointer drag, not a DnD library — this app has
// deliberately avoided adding one anywhere else (bundle size, touch
// reliability), so this stays consistent with that. As the handle crosses
// into a neighboring row's slot it calls
// reorder() to commit the tile straight to that index; the dragged row's
// remaining sub-row-height movement is applied as a live transform so it
// keeps tracking the pointer smoothly between snaps. Enabling/disabling
// tiles no longer happens here — that moved to the per-category "+ Add"
// sheet — so only currently-enabled tiles are listed, and only they need a
// handle at all.
export default function DashboardCustomizeScreen() {
  const navigate = useNavigate();
  const { layout, reorder } = useDashboardLayout();
  const [addingCategory, setAddingCategory] = useState<Category | null>(null);

  // The "Customise dashboard" trigger sits at the very bottom of a long,
  // already-scrolled Dashboard page — react-router doesn't reset window
  // scroll on navigation, so without this the screen would render already
  // scrolled to wherever the Dashboard was, i.e. its own bottom.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Drag key is `category:tileId` — the hook tracks one flat key, and a tile
  // id is only unique within its own category's list.
  const tileDrag = useDragReorder((key, toIndex) => {
    const [category, id] = key.split(":") as [Category, TileId];
    reorder(category, id, toIndex);
  });

  return (
    <div className="min-h-dvh pb-24 bg-dashboardBg">
      <header className="px-4 pt-5 pb-3 flex items-center justify-between">
        <h1 className="text-lg font-medium text-white">Customise dashboard</h1>
        <button onClick={() => navigate("/")} className="text-sm font-bold text-accent">
          Done
        </button>
      </header>

      <main className="px-4 max-w-md mx-auto">
        {CATEGORIES.map((cat, catIndex) => {
          const catalogForCat = TILE_CATALOG.filter((t) => t.category === cat.id);
          const enabledTiles = layout[cat.id]
            .map((id) => catalogForCat.find((t) => t.id === id))
            .filter((t): t is (typeof catalogForCat)[number] => t !== undefined);

          return (
            <div key={cat.id} className={catIndex === 0 ? "" : "mt-6"}>
              <p className="pb-2 text-base font-bold text-white">{cat.label}</p>

              {enabledTiles.length > 0 && (
                <div className="rounded-2xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider">
                  {enabledTiles.map((t, i) => {
                    const Icon = TILE_ICONS[t.id];
                    const dragKey = `${cat.id}:${t.id}`;
                    const dragOffset = tileDrag.drag && tileDrag.drag.key === dragKey ? tileDrag.drag.offset : null;
                    return (
                      <div
                        key={t.id}
                        data-reorder-row
                        className="w-full flex items-center gap-3 px-4 py-3 bg-dashboardCard"
                        style={
                          dragOffset !== null
                            ? { transform: `translateY(${dragOffset}px)`, position: "relative", zIndex: 10 }
                            : undefined
                        }
                      >
                        <Icon size={18} strokeWidth={2} className="text-white shrink-0" />
                        <span className="text-sm text-white truncate flex-1 min-w-0">{t.label}</span>
                        <button
                          onPointerDown={(e) => tileDrag.start(e, dragKey, i, enabledTiles.length - 1)}
                          aria-label={`Reorder ${t.label}`}
                          className="text-muted shrink-0 p-1 touch-none cursor-grab active:cursor-grabbing"
                        >
                          <GripVertical size={18} strokeWidth={2} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                onClick={() => setAddingCategory(cat.id)}
                className="w-full mt-2 py-2.5 text-center text-sm text-white/70 border border-white/20 rounded-xl active:bg-dashboardCard"
              >
                + Add {cat.label}
              </button>
            </div>
          );
        })}
      </main>

      {addingCategory && (
        <AddTilesSheet
          category={addingCategory}
          categoryLabel={CATEGORIES.find((c) => c.id === addingCategory)?.label ?? ""}
          onClose={() => setAddingCategory(null)}
        />
      )}
    </div>
  );
}
