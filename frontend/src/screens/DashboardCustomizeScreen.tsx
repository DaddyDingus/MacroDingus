import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { GripVertical } from "lucide-react";
import { CATEGORIES, TILE_CATALOG, useDashboardLayout, type Category, type TileId } from "../lib/dashboardLayout";
import { TILE_ICONS } from "../lib/tileIcons";
import AddTilesSheet from "../components/AddTilesSheet";

interface DragState {
  category: Category;
  id: TileId;
  startIndex: number;
  currentIndex: number;
  startY: number;
  rowHeight: number;
  offset: number;
}

// Its own screen (not a bottom sheet) reached from the Dashboard's "Customise
// dashboard" tile — back out via the bottom nav's Dashboard tab, same as
// every other tile-drill-down screen in this app (none of them have their
// own back arrow either).
//
// Reordering is a hand-rolled pointer drag, not a DnD library — this app has
// deliberately avoided adding one anywhere else (bundle size, touch
// reliability), so this stays consistent with that. The handle captures the
// pointer on press, and as it crosses into a neighboring row's slot calls
// reorder() to commit the tile straight to that index; the dragged row's
// remaining sub-row-height movement is applied as a live transform so it
// keeps tracking the pointer smoothly between snaps. Enabling/disabling
// tiles no longer happens here — that moved to the per-category "+ Add"
// sheet — so only currently-enabled tiles are listed, and only they need a
// handle at all.
export default function DashboardCustomizeScreen() {
  const navigate = useNavigate();
  const { layout, reorder } = useDashboardLayout();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [addingCategory, setAddingCategory] = useState<Category | null>(null);

  // The "Customise dashboard" trigger sits at the very bottom of a long,
  // already-scrolled Dashboard page — react-router doesn't reset window
  // scroll on navigation, so without this the screen would render already
  // scrolled to wherever the Dashboard was, i.e. its own bottom.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>, category: Category, id: TileId, index: number) {
    e.preventDefault();
    const row = e.currentTarget.closest("[data-tile-row]") as HTMLElement | null;
    const rowHeight = row?.getBoundingClientRect().height ?? 52;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ category, id, startIndex: index, currentIndex: index, startY: e.clientY, rowHeight, offset: 0 });
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const clientY = e.clientY;
    setDrag((d) => {
      if (!d) return d;
      const deltaY = clientY - d.startY;
      const maxIndex = layout[d.category].length - 1;
      const rawShift = Math.round(deltaY / d.rowHeight);
      const newIndex = Math.min(Math.max(d.startIndex + rawShift, 0), maxIndex);
      if (newIndex !== d.currentIndex) reorder(d.category, d.id, newIndex);
      return { ...d, currentIndex: newIndex, offset: deltaY - (newIndex - d.startIndex) * d.rowHeight };
    });
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(null);
  }

  return (
    <div className="min-h-dvh pb-24 bg-dashboardBg">
      <header className="px-4 pt-5 pb-3 flex items-center justify-between">
        <h1 className="text-lg font-medium text-white">Customise dashboard</h1>
        <button onClick={() => navigate("/")} className="text-sm font-bold text-white">
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
                    const isDragging = drag?.category === cat.id && drag.id === t.id;
                    return (
                      <div
                        key={t.id}
                        data-tile-row
                        className="w-full flex items-center gap-3 px-4 py-3 bg-dashboardCard"
                        style={
                          isDragging
                            ? { transform: `translateY(${drag.offset}px)`, position: "relative", zIndex: 10 }
                            : undefined
                        }
                      >
                        <Icon size={18} strokeWidth={2} className="text-white shrink-0" />
                        <span className="text-sm text-white truncate flex-1 min-w-0">{t.label}</span>
                        <button
                          onPointerDown={(e) => handlePointerDown(e, cat.id, t.id, i)}
                          onPointerMove={handlePointerMove}
                          onPointerUp={handlePointerUp}
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
