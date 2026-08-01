import { AlertTriangle } from "lucide-react";
import { useClearAccountData } from "../api/account";
import BottomSheet from "./BottomSheet";

// The strongest confirmation friction in the app — every other delete now
// goes through the shared ConfirmDeleteSheet (a single confirm/cancel step),
// but wiping every weigh-in, log, check-in, goal, program, and photo at once
// is categorically different, so it gets its own more alarming warning sheet
// (irreversible-data-loss framing, not just "delete this one thing?").
export default function ClearAccountDataSheet({ onClose }: { onClose: () => void }) {
  const clearData = useClearAccountData();

  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line">
            <h2 className="text-base font-semibold">Clear Account Data</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="rounded-md p-4 flex gap-3" style={{ background: "rgba(217,89,38,0.12)" }}>
              <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: "#D95926" }} strokeWidth={2} />
              <p className="text-sm">
                This permanently deletes all your weigh-ins, food logs, check-ins, goals, programs, and progress
                photos, and resets your profile. This cannot be undone.
              </p>
            </div>
            <p className="text-xs text-muted px-1">
              Your shared food and recipe library is not affected. You'll be taken through initial setup again the
              next time you open the app.
            </p>
            {clearData.isError && (
              <p className="text-xs text-red-400 text-center">Couldn't clear your data — try again.</p>
            )}
          </div>
          <div className="px-4 pb-4 space-y-2">
            <button
              onClick={() => clearData.mutate(undefined, { onSuccess: onClose })}
              disabled={clearData.isPending}
              className="w-full py-3 rounded-full text-sm font-semibold disabled:opacity-50"
              style={{ background: "#D95926", color: "#0B1210" }}
            >
              {clearData.isPending ? "Clearing…" : "Clear My Data"}
            </button>
            <button onClick={close} disabled={clearData.isPending} className="w-full py-3 rounded-full text-sm font-medium text-muted">
              Cancel
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
