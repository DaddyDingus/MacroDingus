import BottomSheet from "./BottomSheet";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Reuses GoalSetupForm's row styling (bordered vertical list, selected row
// gets bg-surface-raised + accent label) — the closest existing
// radio-list-of-rows pattern in the app, just wrapped in a BottomSheet here
// instead of sitting inline in a form.
export default function ChangeCheckInDaySheet({
  value,
  onSelect,
  onClose,
}: {
  value: number | null;
  onSelect: (dayOfWeek: number) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line">
            <h2 className="text-base font-semibold">Check-In Day</h2>
            <p className="text-xs text-muted mt-1">Weekday when you check in</p>
          </div>
          <div className="overflow-y-auto">
            {DAY_LABELS.map((label, dayOfWeek) => {
              const selected = value === dayOfWeek;
              return (
                <button
                  key={dayOfWeek}
                  onClick={() => {
                    onSelect(dayOfWeek);
                    close();
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 border-b border-line/60 last:border-b-0 text-left ${selected ? "bg-surface-raised" : ""}`}
                >
                  <span className={`text-sm ${selected ? "text-accent" : ""}`}>{label}</span>
                  <span className={`w-4 h-4 rounded-full border-2 ${selected ? "bg-accent border-accent" : "border-line"}`} />
                </button>
              );
            })}
          </div>
        </>
      )}
    </BottomSheet>
  );
}
