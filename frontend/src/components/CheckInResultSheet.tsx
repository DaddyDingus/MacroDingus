import type { Checkin, CheckinTargetChanges } from "../api/coach";
import { useEnergyUnit, formatEnergy, kcalToUnit } from "../lib/energyUnit";
import BottomSheet from "./BottomSheet";

// Shown right after a successful check-in — reuses the same "here's what
// this number means" reasoning framing the New Program wizard's results
// screen uses, scoped to what a check-in actually does: refresh the TDEE
// estimate, and (for a Coached, non-hand-edited program) refresh that
// program's targets to match. No dedicated "breakdown" payload exists for
// a check-in the way program creation returns one — this reads straight
// off the Checkin the mutation already returned, plus the before/after
// target averages the check-in computed while regenerating program_days.

// One target's move. `delta` is signed and rendered as a chip; a zero delta
// still gets a row (the target genuinely held steady, which is information)
// but stays neutral rather than borrowing an up/down color.
function ChangeRow({
  label,
  color,
  from,
  to,
  format,
  formatCompact = format,
}: {
  label: string;
  color: string;
  from: number;
  to: number;
  // Carries the unit — used for the one value that's the real answer.
  format: (value: number) => string;
  // Defaults to `format`. Calories override it with a bare number so the
  // row doesn't say "kcal" three times; grams are short enough to repeat.
  formatCompact?: (value: number) => string;
}) {
  const delta = to - from;
  const unchanged = Math.round(delta) === 0;
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex items-center gap-2 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} aria-hidden="true" />
        <span className="text-sm">{label}</span>
      </span>
      <span className="flex items-baseline gap-2 shrink-0">
        <span className="tabular text-xs text-muted line-through decoration-muted/60">{formatCompact(from)}</span>
        <span className="tabular text-sm font-semibold">{format(to)}</span>
        <span
          className="tabular text-[11px] font-semibold rounded-full px-1.5 py-0.5 min-w-[3.25rem] text-center"
          style={
            unchanged
              ? { background: "rgba(236,237,238,0.08)", color: "#8A8F98" }
              : { background: `${color}1F`, color }
          }
        >
          {unchanged ? "—" : `${delta > 0 ? "+" : "−"}${formatCompact(Math.abs(delta))}`}
        </span>
      </span>
    </div>
  );
}

export default function CheckInResultSheet({
  checkin,
  usedAdaptiveTdee,
  targetChanges,
  onClose,
}: {
  checkin: Checkin;
  usedAdaptiveTdee: boolean;
  targetChanges: CheckinTargetChanges | null;
  onClose: () => void;
}) {
  const { unit } = useEnergyUnit();
  const grams = (value: number) => `${Math.round(value)}g`;
  // Converted for display only — the backend deals purely in kcal (see
  // lib/energyUnit.tsx). Rounding after conversion matters for kJ, where a
  // 10 kcal move is ~42 kJ, not a rounding artifact.
  const energy = (kcal: number) => formatEnergy(kcal, unit);
  const energyNumber = (kcal: number) => Math.round(kcalToUnit(kcal, unit)).toLocaleString();

  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line">
            <h2 className="text-base font-semibold">Check-In Complete</h2>
          </div>
          <div className="p-4 space-y-3 overflow-y-auto">
            <div className="rounded-md bg-surface-raised p-4">
              <p className="text-[11px] tracking-widest uppercase text-muted">Estimated Expenditure</p>
              <p className="tabular text-2xl font-semibold mt-1">{energy(checkin.tdee)}</p>
              <p className="text-xs text-muted mt-1">
                {usedAdaptiveTdee
                  ? "Calculated from your actual weight trend and logged calories."
                  : "Estimated from your profile using a formula — log more weigh-ins and food to switch to your real numbers."}
              </p>
            </div>

            {targetChanges ? (
              <div className="rounded-md bg-surface-raised p-4">
                <p className="text-[11px] tracking-widest uppercase text-muted">Your Daily Targets</p>
                <div className="mt-1 divide-y divide-line">
                  <ChangeRow
                    label="Calories"
                    color="#749EF4"
                    from={targetChanges.calories.from}
                    to={targetChanges.calories.to}
                    format={energy}
                    formatCompact={energyNumber}
                  />
                  <ChangeRow label="Protein" color="#EF8D6A" from={targetChanges.proteinG.from} to={targetChanges.proteinG.to} format={grams} />
                  <ChangeRow label="Fat" color="#F7D372" from={targetChanges.fatG.from} to={targetChanges.fatG.to} format={grams} />
                  <ChangeRow label="Carbs" color="#5ABC80" from={targetChanges.carbsG.from} to={targetChanges.carbsG.to} format={grams} />
                </div>
                <p className="text-xs text-muted mt-2">
                  {/* Program days can differ from each other (a shifted
                      distribution), so this is the daily average across the
                      week — the number the program is actually built around. */}
                  Daily average across your week. Check the Strategy tab for each day.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted px-1">
                Your targets weren't changed — a check-in only refreshes them for a Coached program whose days haven't been hand-edited.
              </p>
            )}
          </div>
          <div className="px-4 pb-4 pt-2">
            <button
              onClick={close}
              className="w-full py-3 rounded-full text-sm font-semibold"
              style={{ background: "#ECEDEE", color: "#0B1210" }}
            >
              Done
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
