import { ListChecks, Copy, Trash2, TrendingUp, CircleAlert, type LucideIcon } from "lucide-react";
import BottomSheet from "./BottomSheet";

function Row({
  icon: Icon,
  label,
  disabled,
  destructive,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-white/5 disabled:opacity-30 ${
        destructive ? "text-protein" : "text-white"
      }`}
    >
      <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={2} />
      <span className="text-sm">{label}</span>
    </button>
  );
}

// Consolidates the Food Log's whole-day actions (previously just a lone Copy
// icon in the header) behind one overflow entry point — Select All and Clear
// Day need a way to act before anything's been manually selected, which a
// per-row/per-group tap can't provide on its own. Select All simply hands
// every one of today's entries to TodayScreen's existing selection state, so
// it rides the same LogActionBar (Edit/Copy/Move/Delete) selecting one entry
// already does — no separate "bulk mode" UI. Clear Day goes through its own
// ConfirmDeleteSheet in the caller rather than this sheet's own confirm, so
// dismissing this menu doesn't also dismiss an in-flight confirmation.
export default function DayMenuSheet({
  hasEntries,
  hasAdjustment,
  incomplete,
  onSelectAll,
  onCopyDay,
  onClearDay,
  onCarryForward,
  onRemoveAdjustment,
  onToggleIncomplete,
  onClose,
}: {
  hasEntries: boolean;
  // Whether this date already has a "Carry Forward Shortfall" boost applied
  // — flips the row below between offering one and offering to undo it,
  // rather than showing both at once (one adjustment per date; see
  // api/adjustments.ts).
  hasAdjustment: boolean;
  incomplete: boolean;
  onSelectAll: () => void;
  onCopyDay: () => void;
  onClearDay: () => void;
  onCarryForward: () => void;
  onRemoveAdjustment: () => void;
  onToggleIncomplete: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="bg-dashboardBg rounded-t-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-1 pb-3 flex items-center shrink-0 touch-none">
            <span className="text-sm font-medium text-white">Day actions</span>
          </div>
          {/* Two rounded cards, not one flat list with edge-to-edge hairline
              dividers — this sheet used to be the one place in the app with
              that older iOS-settings-list look, next to CopyDaySheet's own
              rounded-2xl bg-dashboardCard picker (one tap away, from this
              same menu) using the card treatment instead. Clear Day gets its
              own separate card below a gap rather than joining the first
              one — the classic iOS action-sheet split between neutral and
              destructive actions, so it doesn't sit flush against Select
              All/Copy Day. */}
          <div className="px-4 pb-4 space-y-3 shrink-0">
            <div className="rounded-2xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider">
              <Row
                icon={ListChecks}
                label="Select All"
                disabled={!hasEntries}
                onClick={() => {
                  onSelectAll();
                  close();
                }}
              />
              <Row
                icon={Copy}
                label="Copy This Day"
                onClick={() => {
                  onCopyDay();
                  close();
                }}
              />
              <Row
                icon={TrendingUp}
                label={hasAdjustment ? "Remove Carried-Forward Macros" : "Carry Forward Yesterday's Shortfall"}
                onClick={() => {
                  if (hasAdjustment) onRemoveAdjustment();
                  else onCarryForward();
                  close();
                }}
              />
              <Row
                icon={CircleAlert}
                label={incomplete ? "Include Day in Coaching" : "Mark Food Log Incomplete"}
                disabled={!hasEntries && !incomplete}
                onClick={() => {
                  onToggleIncomplete();
                  close();
                }}
              />
            </div>
            <div className="rounded-2xl bg-dashboardCard overflow-hidden">
              <Row
                icon={Trash2}
                label="Clear Day"
                destructive
                disabled={!hasEntries}
                onClick={() => {
                  onClearDay();
                  close();
                }}
              />
            </div>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
