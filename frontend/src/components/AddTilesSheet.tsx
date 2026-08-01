import { TILE_CATALOG, useDashboardLayout, type Category } from "../lib/dashboardLayout";
import { TILE_ICONS } from "../lib/tileIcons";
import BottomSheet from "./BottomSheet";
import ToggleSwitch from "./ToggleSwitch";

// Opened from the "+ Add {category}" button on DashboardCustomizeScreen —
// scoped to one category at a time. This is the only place tiles get
// switched on/off; the customize screen itself only reorders what's already on.
export default function AddTilesSheet({
  category,
  categoryLabel,
  onClose,
}: {
  category: Category;
  categoryLabel: string;
  onClose: () => void;
}) {
  const { layout, toggle } = useDashboardLayout();
  const catalogForCat = TILE_CATALOG.filter((t) => t.category === category);
  const enabledOrder = layout[category];

  return (
    <BottomSheet onClose={onClose}>
      {(dragHandlers, close) => (
        <>
      <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center justify-between shrink-0 touch-none">
        <span className="text-sm font-medium text-white">Add to {categoryLabel}</span>
        <button onClick={close} className="text-xs font-bold text-white">
          Done
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="rounded-2xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider">
          {catalogForCat.map((t) => {
            const Icon = TILE_ICONS[t.id];
            const enabled = enabledOrder.includes(t.id);
            return (
              <button
                key={t.id}
                role="switch"
                aria-checked={enabled}
                onClick={() => toggle(category, t.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                <Icon size={18} strokeWidth={2} className={`shrink-0 ${enabled ? "text-white" : "text-muted"}`} />
                <span className={`text-sm truncate flex-1 min-w-0 ${enabled ? "text-white" : "text-muted"}`}>
                  {t.label}
                </span>
                <ToggleSwitch on={enabled} />
              </button>
            );
          })}
        </div>
      </div>
        </>
      )}
    </BottomSheet>
  );
}
