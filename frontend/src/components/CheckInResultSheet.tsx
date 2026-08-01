import type { Checkin } from "../api/coach";
import BottomSheet from "./BottomSheet";

// Shown right after a successful check-in — reuses the same "here's what
// this number means" reasoning framing the New Program wizard's results
// screen uses, scoped to what a check-in actually does: refresh the TDEE
// estimate, and (for a Coached, non-hand-edited program) refresh that
// program's targets to match. No dedicated "breakdown" payload exists for
// a check-in the way program creation returns one — this reads straight
// off the Checkin the mutation already returned.
export default function CheckInResultSheet({
  checkin,
  usedAdaptiveTdee,
  onClose,
}: {
  checkin: Checkin;
  usedAdaptiveTdee: boolean;
  onClose: () => void;
}) {
  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line">
            <h2 className="text-base font-semibold">Check-In Complete</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="rounded-md bg-surface-raised p-4">
              <p className="text-[11px] tracking-widest uppercase text-muted">Estimated Expenditure</p>
              <p className="tabular text-2xl font-semibold mt-1">{checkin.tdee} kcal</p>
              <p className="text-xs text-muted mt-1">
                {usedAdaptiveTdee
                  ? "Calculated from your actual weight trend and logged calories."
                  : "Estimated from your profile using a formula — log more weigh-ins and food to switch to your real numbers."}
              </p>
            </div>
            <p className="text-xs text-muted px-1">
              If your active program is Coached and hasn't been hand-edited on a specific day, its targets have been refreshed to match this
              estimate.
            </p>
          </div>
          <div className="px-4 pb-4">
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
