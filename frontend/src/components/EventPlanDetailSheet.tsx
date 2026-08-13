import { useState } from "react";
import BottomSheet from "./BottomSheet";
import DecimalInput from "./DecimalInput";
import {
  useDeleteEventPlan,
  useEditEventPlanDays,
  useResetEventPlan,
  useSettleEventPlan,
  type EventPlan,
} from "../api/eventPlans";
import { planTitle } from "../lib/eventPlanCopy";
import { formatDayLabel, localDateString } from "../lib/date";
import { useEnergyUnit, formatEnergy, kcalToUnit, unitToKcal } from "../lib/energyUnit";
import { ApiError } from "../api/client";

export default function EventPlanDetailSheet({ plan, onClose }: { plan: EventPlan; onClose: () => void }) {
  const today = localDateString();
  const { unit: energyUnit } = useEnergyUnit();
  const editDays = useEditEventPlanDays(plan.id);
  const reset = useResetEventPlan(plan.id);
  const settle = useSettleEventPlan(plan.id);
  const remove = useDeleteEventPlan();
  const [error, setError] = useState<string | null>(null);
  // Which day is being hand-edited, and the in-progress text. Only one at a
  // time — the keypad owns the screen while it's open.
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const eventDayPassed = plan.eventDate < today;

  function commitEdit(date: string) {
    const value = Number(editText);
    if (!Number.isFinite(value)) {
      setEditing(null);
      return;
    }
    // The field shows a magnitude; offset days are cuts, so the sign comes
    // from which side of the event the day sits on rather than from the user
    // typing a minus.
    const signed = date === plan.eventDate ? Math.abs(value) : -Math.abs(value);
    setError(null);
    editDays.mutate([{ date, kcalDelta: unitToKcal(signed, energyUnit) }], {
      onSuccess: () => setEditing(null),
      onError: () => setError("Couldn't save that change — try again."),
    });
  }

  function runSettle() {
    setError(null);
    settle.mutate(undefined, {
      onError: (err) =>
        setError(
          err instanceof ApiError && err.message.includes("event_day_not_logged")
            ? "Nothing is logged on the event day yet."
            : "Couldn't settle that plan — try again."
        ),
    });
  }

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[90%] bg-dashboardBg rounded-t-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers) => (
        <>
          <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
            <span className="text-sm font-medium text-white">{planTitle(plan)}</span>
          </div>
          <div className="px-4 pb-4 overflow-y-auto space-y-4">
            <div>
              <p className="text-sm text-white/80">
                {formatDayLabel(plan.eventDate)} · {formatEnergy(plan.eventKcal, energyUnit)}
              </p>
              <p className="text-[11px] text-muted mt-0.5">
                {plan.settledAt
                  ? "Settled against what you actually logged."
                  : plan.kind === "recovery"
                    ? "Recovering from a day that went over."
                    : "Estimated — settle it once the day is logged."}
                {plan.distributionMode === "custom" && " · Hand-edited"}
              </p>
            </div>

            <div className="rounded-2xl bg-dashboardCard divide-y divide-line/60">
              {plan.days.map((d) => {
                const isEvent = d.date === plan.eventDate;
                const past = d.date < today;
                const isEditing = editing === d.date;
                return (
                  <div key={d.id} className="flex items-center justify-between px-4 py-2.5 gap-3">
                    <div className="min-w-0">
                      <p className={`text-sm truncate ${isEvent ? "text-white" : "text-muted"}`}>
                        {formatDayLabel(d.date)}
                      </p>
                      {past && <p className="text-[11px] text-muted/60">Already passed</p>}
                    </div>
                    {isEditing ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <DecimalInput
                          value={editText}
                          onChange={setEditText}
                          label={`Amount for ${formatDayLabel(d.date)}`}
                          allowDecimal={false}
                          autoOpen
                          onDone={() => commitEdit(d.date)}
                          className="w-20 bg-dashboardBg border border-line rounded px-2 py-1 text-sm tabular text-left focus:outline-none focus:border-accent"
                        />
                        <button onClick={() => commitEdit(d.date)} className="text-xs text-accent">
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        disabled={past}
                        onClick={() => {
                          setEditing(d.date);
                          setEditText(String(Math.round(Math.abs(kcalToUnit(d.kcalDelta, energyUnit)))));
                        }}
                        className="tabular text-sm shrink-0 disabled:opacity-60"
                      >
                        <span className={isEvent ? "text-white" : "text-muted"}>
                          {d.kcalDelta > 0 ? "+" : "−"}
                          {formatEnergy(Math.abs(d.kcalDelta), energyUnit)}
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {error && <p className="text-xs text-protein">{error}</p>}

            <div className="space-y-2">
              {eventDayPassed && !plan.settledAt && (
                <button
                  onClick={runSettle}
                  disabled={settle.isPending}
                  className="w-full rounded-2xl bg-accent text-white text-sm font-medium py-3 active:opacity-80 disabled:opacity-50"
                >
                  {settle.isPending ? "Settling…" : "Settle from what I actually ate"}
                </button>
              )}
              {plan.distributionMode === "custom" && (
                <button
                  onClick={() => reset.mutate()}
                  disabled={reset.isPending}
                  className="w-full rounded-2xl border border-line text-white/80 text-sm py-3 active:opacity-80 disabled:opacity-50"
                >
                  {reset.isPending ? "Resetting…" : "Reset to an even spread"}
                </button>
              )}
              <button
                onClick={() => remove.mutate(plan.id, { onSuccess: onClose })}
                disabled={remove.isPending}
                className="w-full rounded-2xl border border-line text-protein text-sm py-3 active:opacity-80 disabled:opacity-50"
              >
                {remove.isPending ? "Removing…" : "Cancel this plan"}
              </button>
            </div>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
