import { useState } from "react";
import BottomSheet from "./BottomSheet";
import { useDayLog } from "../api/logs";
import { usePrograms } from "../api/programs";
import { useSaveAdjustment } from "../api/adjustments";
import { targetsForDate } from "../lib/programTargets";
import { addDays, formatDayLabel } from "../lib/date";
import { useEnergyUnit, formatEnergy } from "../lib/energyUnit";
import { ApiError } from "../api/client";

// A skipped/underfed day shouldn't license doubling up the next day —
// calories/carbs/fat can make up at most half of the source day's target;
// protein is capped tighter (a quarter), since muscle protein synthesis
// cares about daily spread, not just the weekly total, so a large one-day
// protein bump is a worse "make-up" than a calorie deficit is.
const GENEROUS_CAP = 0.5;
const PROTEIN_CAP = 0.25;

function shortfall(target: number, actual: number, cap: number): number {
  return Math.min(Math.max(target - actual, 0), target * cap);
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-white/80">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="tabular text-white font-medium">{value}</span>
    </div>
  );
}

// Opened from DayMenuSheet's "Carry Forward Shortfall" row. `date` is
// whatever day TodayScreen is currently viewing (not necessarily real
// today) — the boost always applies to that viewed date, carried from the
// single calendar day immediately before it. Only ever offered going one
// day back, so this doesn't turn into an open-ended "redistribute my whole
// week" tool.
export default function CarryForwardSheet({ date, onClose }: { date: string; onClose: () => void }) {
  const sourceDate = addDays(date, -1);
  const dayLog = useDayLog(sourceDate);
  const programs = usePrograms();
  const save = useSaveAdjustment(date);
  const { unit: energyUnit } = useEnergyUnit();
  const [error, setError] = useState<string | null>(null);

  const loading = dayLog.isLoading || programs.isLoading;
  const targets = targetsForDate(programs.data ?? [], sourceDate);
  const totals = dayLog.data?.totals ?? null;
  const hasEntries = (dayLog.data?.entries.length ?? 0) > 0;

  const amount =
    targets && totals
      ? {
          kcal: shortfall(targets.calories, totals.calories, GENEROUS_CAP),
          proteinG: shortfall(targets.proteinG, totals.protein, PROTEIN_CAP),
          carbsG: shortfall(targets.carbsG, totals.carbs, GENEROUS_CAP),
          fatG: shortfall(targets.fatG, totals.fat, GENEROUS_CAP),
        }
      : null;
  const nothingToCarry = amount != null && amount.kcal <= 0;

  function confirm() {
    if (!amount) return;
    setError(null);
    save.mutate(
      { sourceDate, ...amount },
      {
        onSuccess: onClose,
        onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't carry that forward — try again."),
      }
    );
  }

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="bg-dashboardBg rounded-t-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers) => (
        <>
          <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
            <span className="text-sm font-medium text-white">Carry Forward Shortfall</span>
          </div>
          <div className="px-4 pb-4">
            {loading && <p className="py-8 text-sm text-muted text-center">Loading…</p>}
            {!loading && !targets && (
              <p className="py-8 text-sm text-muted text-center">No target was set for {formatDayLabel(sourceDate)}.</p>
            )}
            {!loading && targets && !hasEntries && (
              <p className="py-8 text-sm text-muted text-center">Nothing was logged on {formatDayLabel(sourceDate)}.</p>
            )}
            {!loading && targets && hasEntries && nothingToCarry && (
              <p className="py-8 text-sm text-muted text-center">
                You hit your targets on {formatDayLabel(sourceDate)} — nothing to carry forward.
              </p>
            )}
            {!loading && targets && hasEntries && amount && !nothingToCarry && (
              <>
                <p className="text-sm text-muted pb-3">
                  On {formatDayLabel(sourceDate)} you came in under target by the amount below. Add it to{" "}
                  {formatDayLabel(date)}'s target?
                </p>
                <div className="rounded-2xl bg-dashboardCard px-4 py-3.5 space-y-2">
                  <Row label="Calories" value={`+${formatEnergy(amount.kcal, energyUnit)}`} color="#749EF4" />
                  <Row label="Protein" value={`+${Math.round(amount.proteinG)}g`} color="#EF8D6A" />
                  <Row label="Carbs" value={`+${Math.round(amount.carbsG)}g`} color="#5ABC80" />
                  <Row label="Fat" value={`+${Math.round(amount.fatG)}g`} color="#F7D372" />
                </div>
                {error && <p className="pt-3 text-xs text-protein">{error}</p>}
                <button
                  onClick={confirm}
                  disabled={save.isPending}
                  className="w-full mt-4 rounded-2xl bg-accent text-white text-sm font-medium py-3 active:opacity-80 disabled:opacity-50"
                >
                  {save.isPending ? "Adding…" : "Add to This Day"}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </BottomSheet>
  );
}
