import { AlertTriangle, Upload } from "lucide-react";
import { useImportAccountData } from "../api/account";
import BottomSheet from "./BottomSheet";

export default function RestoreAccountDataSheet({ file, onClose }: { file: File; onClose: () => void }) {
  const restore = useImportAccountData();

  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line">
            <h2 className="text-base font-semibold">Restore data export?</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="rounded-md p-4 flex gap-3" style={{ background: "rgba(217,89,38,0.12)" }}>
              <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: "#D95926" }} strokeWidth={2} />
              <p className="text-sm">
                This replaces the current account's logs, weights, goals, programs, recipes, preferences, and other
                saved data with the contents of this export.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-dashboardBg px-3 py-3 flex items-center gap-3">
              <Upload size={17} className="text-muted shrink-0" />
              <div className="min-w-0">
                <p className="text-sm truncate">{file.name}</p>
                <p className="text-xs text-muted">{Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB</p>
              </div>
            </div>
            <p className="text-xs text-muted px-1">
              Progress-photo image files and secret API keys aren't contained in JSON exports. Existing progress
              photos are left untouched; the server's automatic backup of the database and photos runs separately.
            </p>
            {restore.isError && (
              <p className="text-xs text-red-400 text-center">
                {restore.error instanceof Error ? restore.error.message : "The export could not be restored."}
              </p>
            )}
          </div>
          <div className="px-4 pb-4 space-y-2">
            <button
              onClick={() => restore.mutate(file, { onSuccess: close })}
              disabled={restore.isPending}
              className="w-full py-3 rounded-full text-sm font-semibold disabled:opacity-50"
              style={{ background: "#D95926", color: "#0B1210" }}
            >
              {restore.isPending ? "Restoring…" : "Replace and Restore"}
            </button>
            <button onClick={close} disabled={restore.isPending} className="w-full py-3 rounded-full text-sm font-medium text-muted">
              Cancel
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
