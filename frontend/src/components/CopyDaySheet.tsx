import { useState } from "react";
import { useRecentDays, useCopyDay } from "../api/logs";
import { formatDayLabel } from "../lib/date";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";
import { ApiError } from "../api/client";
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
  const { unit: energyUnit } = useEnergyUnit();
  // The old version fired the mutation and closed the sheet in the same
  // tick, so a failed copy (network blip, server error) had nowhere to show
  // up — the sheet was already gone. Now the tapped row stays put and shows
  // a spinner until the request actually resolves, and only closes on
  // success; a failure surfaces inline instead of vanishing silently.
  const [copyingDate, setCopyingDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const days = (recentDays.data ?? []).filter((d) => d.date !== targetDate);
  const maxCalories = Math.max(1, ...days.map((d) => d.calories));

  function pick(sourceDate: string) {
    setError(null);
    setCopyingDate(sourceDate);
    copyDay.mutate(
      { sourceDate },
      {
        onSuccess: onClose,
        onError: (err) => {
          setCopyingDate(null);
          setError(err instanceof ApiError ? err.message : "Couldn't copy that day — try again.");
        },
      }
    );
  }

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[75vh] bg-dashboardBg rounded-t-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers) => (
        <>
      {/* No Close button — swipe-down (the grabber, or this header) or a tap
          on the backdrop dismiss the sheet, so a redundant × isn't needed. */}
      <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
        <span className="text-sm font-medium text-white">Copy a day from…</span>
      </div>

      {error && <p className="px-4 pb-2 text-xs text-protein shrink-0">{error}</p>}

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {days.length === 0 && <p className="px-2 py-8 text-sm text-muted text-center">Nothing logged yet.</p>}
        {days.length > 0 && (
          <div className="rounded-2xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider">
            {days.map((d) => {
              const isCopying = copyingDate === d.date;
              // A relative-magnitude bar, not tied to any target (recent-days
              // has no per-day target to compare against, and targets change
              // over time anyway) — just "how big was this day next to the
              // others in this list," so a binge day or a near-fast are
              // visible at a glance instead of only as raw numbers.
              const barPct = Math.max(4, Math.round((d.calories / maxCalories) * 100));
              return (
                <button
                  key={d.date}
                  onClick={() => pick(d.date)}
                  disabled={copyDay.isPending}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-surface-raised disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-white">{formatDayLabel(d.date)}</span>
                    <span className="mt-1.5 flex items-center gap-2">
                      <span className="h-1.5 w-16 rounded-full bg-dashboardTrack overflow-hidden shrink-0">
                        <span className="block h-full rounded-full bg-calories" style={{ width: `${barPct}%` }} />
                      </span>
                      <span className="tabular text-xs text-muted">
                        {Math.round(kcalToUnit(d.calories, energyUnit))} {energyUnitLabel(energyUnit)} · {d.entryCount}{" "}
                        item{d.entryCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </span>
                  {isCopying && (
                    <span
                      aria-hidden="true"
                      className="shrink-0 h-4 w-4 rounded-full border-2 border-white/25 border-t-white animate-spin"
                    />
                  )}
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
