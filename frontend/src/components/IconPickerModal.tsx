import { useState } from "react";
import { X } from "lucide-react";
import { CURATED_FOOD_ICONS } from "../lib/foodEmoji";
import { useBackDismiss } from "../lib/useBackDismiss";

// Centered dialog, same "fixed inset-0 + backdrop tap-to-dismiss" shape as
// AddFoodSheet's UnloggedPlateWarning — the only other non-BottomSheet modal
// in the app, reused here rather than inventing a second dialog convention.
// Two ways to pick an icon: tap a curated food emoji, or type/paste any
// emoji via the device's own emoji keyboard into the free-text field —
// the curated grid alone can't cover everything a household might log
// (baby food, specific dishes, whatever), and a plain text input alone has
// no discoverability for someone who doesn't think to reach for their
// keyboard's emoji picker.
export default function IconPickerModal({
  value,
  autoPreview,
  onSelect,
  onClose,
}: {
  value: string | null;
  // The keyword-guessed emoji (or letter) this food would fall back to if no
  // override were set — shown as the "Auto" option's own preview so picking
  // it back doesn't look like a dead gray tile.
  autoPreview: string;
  onSelect: (icon: string | null) => void;
  onClose: () => void;
}) {
  const [customInput, setCustomInput] = useState(value && !CURATED_FOOD_ICONS.includes(value) ? value : "");

  useBackDismiss(true, onClose);

  function choose(icon: string | null) {
    onSelect(icon);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-6" onClick={onClose}>
      <div
        className="w-full max-w-xs rounded-2xl bg-dashboardCard border border-white/10 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-white">Choose icon</span>
          <button onClick={onClose} aria-label="Close" className="h-7 w-7 flex items-center justify-center rounded-full text-muted active:bg-white/10">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <button
          onClick={() => choose(null)}
          className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 mb-3 text-left ${
            value === null ? "bg-accent/15 ring-1 ring-accent" : "bg-surface-raised active:bg-white/10"
          }`}
        >
          <span className="shrink-0 w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center text-lg leading-none">
            {autoPreview}
          </span>
          <span className="min-w-0">
            <span className="block text-sm text-white">Auto</span>
            <span className="block text-[11px] text-muted">Guessed from the name</span>
          </span>
        </button>

        <div className="grid grid-cols-7 gap-1.5 max-h-48 overflow-y-auto pr-0.5">
          {CURATED_FOOD_ICONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => choose(emoji)}
              aria-label={emoji}
              className={`aspect-square rounded-lg flex items-center justify-center text-xl leading-none ${
                value === emoji ? "bg-accent/25 ring-1 ring-accent" : "bg-surface-raised active:bg-white/10"
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-dashboardDivider">
          <span className="text-xs text-muted shrink-0">Or type any emoji</span>
          <input
            value={customInput}
            autoComplete="off"
            onChange={(e) => setCustomInput(e.target.value.trim().slice(0, 8))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customInput.trim()) {
                e.preventDefault();
                choose(customInput.trim());
              }
            }}
            placeholder="🍽️"
            className="min-w-0 flex-1 rounded-lg bg-surface-raised border border-line px-2.5 py-1.5 text-lg text-center focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => customInput.trim() && choose(customInput.trim())}
            disabled={!customInput.trim()}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ color: "#0B1210" }}
          >
            Use
          </button>
        </div>
      </div>
    </div>
  );
}
