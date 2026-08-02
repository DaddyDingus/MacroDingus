import { useBackDismiss } from "../lib/useBackDismiss";

// A small centered confirmation, not a native window.confirm() — this app
// builds its own dark-themed dialogs/sheets everywhere else, and a native
// browser prompt would look jarringly out of place here. z-[70], above both
// a full-screen modal (z-50) and the barcode scanner (z-[60]), since either
// could in principle be what's open behind it. Originally AddFoodSheet's own
// private UnloggedPlateWarning — extracted so RecipeForm's own "leave with
// unsaved ingredients?" prompt can reuse the exact same look instead of a
// second hand-rolled dialog.
export default function DiscardWarningSheet({
  title,
  message,
  cancelLabel = "Keep editing",
  confirmLabel = "Close anyway",
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  cancelLabel?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // This dialog is itself conditionally rendered by its parent, so it's only
  // ever mounted while showing — its own history entry layers on top of
  // whatever's underneath, so back dismisses just the warning (onCancel)
  // first, then a second back reaches the screen underneath.
  useBackDismiss(true, onCancel);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-6" onClick={onCancel}>
      <div
        className="w-full max-w-xs rounded-2xl bg-dashboardCard border border-white/10 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-[13px] text-muted mt-1.5 leading-snug">{message}</p>
        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-full border border-white/15 text-sm font-medium text-white active:bg-white/5"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-full bg-white text-sm font-bold text-black active:bg-white/90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
