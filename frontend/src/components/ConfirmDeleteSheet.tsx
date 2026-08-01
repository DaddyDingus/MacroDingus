import { AlertTriangle } from "lucide-react";
import BottomSheet from "./BottomSheet";

export default function ConfirmDeleteSheet({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
  isPending,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  isPending?: boolean;
}) {
  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line"
    >
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line shrink-0 touch-none">
            <h2 className="text-base font-semibold">{title}</h2>
          </div>
          <div className="p-4">
            <div className="rounded-md p-4 flex gap-3" style={{ background: "rgba(217,89,38,0.12)" }}>
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#D95926" }} strokeWidth={2} />
              <p className="text-sm">{message}</p>
            </div>
          </div>
          <div className="px-4 pb-6 space-y-2 shrink-0">
            <button
              onClick={onConfirm}
              disabled={isPending}
              className="w-full py-3 rounded-full text-sm font-semibold disabled:opacity-50"
              style={{ background: "#D95926", color: "#0B1210" }}
            >
              {isPending ? "Deleting…" : confirmLabel}
            </button>
            <button
              onClick={close}
              disabled={isPending}
              className="w-full py-3 rounded-full text-sm font-medium text-muted"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
