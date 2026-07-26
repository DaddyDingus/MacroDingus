import { useRecentDays, useCopyDay } from "../api/logs";
import { formatDayLabel } from "../lib/date";
import BottomSheet from "./BottomSheet";

export default function CopyDaySheet({
  targetDate,
  onClose,
}: {
  targetDate: string;
  onClose: () => void;
}) {
  const recentDays = useRecentDays();
  const copyDay = useCopyDay(targetDate);

  const days = (recentDays.data ?? []).filter((d) => d.date !== targetDate);

  function pick(sourceDate: string) {
    copyDay.mutate({ sourceDate });
    onClose();
  }

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[75vh] bg-surface rounded-t-xl border-t border-line"
    >
      <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
        <span className="text-sm font-medium">Copy a day from…</span>
        <button onClick={onClose} className="text-muted text-xl leading-none px-1">
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
        {days.length === 0 && <p className="px-4 py-6 text-sm text-muted text-center">Nothing logged yet.</p>}
        {days.map((d) => (
          <button
            key={d.date}
            onClick={() => pick(d.date)}
            className="w-full flex items-center justify-between px-4 py-3 border-b border-line/60 text-left active:bg-surface-raised"
          >
            <span className="text-sm">{formatDayLabel(d.date)}</span>
            <span className="tabular text-xs text-muted">
              {d.calories} kcal · {d.entryCount} item{d.entryCount === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
