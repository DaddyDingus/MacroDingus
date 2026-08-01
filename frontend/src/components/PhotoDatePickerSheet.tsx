import { Check } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { formatDayLabel } from "../lib/date";

export default function PhotoDatePickerSheet({
  title,
  dates,
  selectedDate,
  onSelect,
  onClose,
}: {
  title: string;
  dates: string[];
  selectedDate: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/60"
      panelClassName="max-h-[75vh] bg-dashboardBg rounded-t-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
            <span className="text-sm font-medium text-white">{title}</span>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {dates.length === 0 ? (
              <p className="px-2 py-8 text-sm text-muted text-center">
                No photos logged for this pose yet.
              </p>
            ) : (
              <div className="rounded-2xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider">
                {dates.map((date) => {
                  const isSelected = date === selectedDate;
                  return (
                    <button
                      key={date}
                      onClick={() => {
                        onSelect(date);
                        close();
                      }}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-surface-raised"
                    >
                      <span className="text-sm text-white">{formatDayLabel(date)}</span>
                      {isSelected && <Check size={16} strokeWidth={3} className="text-accent" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </BottomSheet>
  );
}
