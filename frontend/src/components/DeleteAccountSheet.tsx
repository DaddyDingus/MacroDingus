import { AlertTriangle } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { useDeleteAccount, type AdminUser } from "../api/admin";

// Deliberately does not ask you to type the account name to confirm. No other
// destructive action in this app does (ClearAccountDataSheet, the strongest
// one, is a plain warning + button), and a native text input inside a sheet
// brings the Android keyboard/viewport problems documented in CLAUDE.md for
// no real safety gain at household scale.
export default function DeleteAccountSheet({
  user,
  accountManagerUrl,
  onClose,
}: {
  user: AdminUser;
  accountManagerUrl: string | null;
  onClose: () => void;
}) {
  const deleteAccount = useDeleteAccount();
  const hasData = user.logCount > 0 || user.weightCount > 0 || user.photoCount > 0;

  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line shrink-0 touch-none">
            <h2 className="text-base font-semibold">Delete {user.name}</h2>
          </div>
          <div className="p-4 space-y-3 overflow-y-auto">
            <div className="rounded-md p-4 flex gap-3" style={{ background: "rgba(217,89,38,0.12)" }}>
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#D95926" }} strokeWidth={2} />
              <p className="text-sm">
                {hasData
                  ? `This permanently deletes ${user.name}'s ${user.logCount} food ${user.logCount === 1 ? "entry" : "entries"}, ${user.weightCount} ${user.weightCount === 1 ? "weigh-in" : "weigh-ins"}, and ${user.photoCount} progress ${user.photoCount === 1 ? "photo" : "photos"}, along with their goals, programs, and check-ins. This cannot be undone.`
                  : `This account has no logged data yet. Deleting it removes the account itself. This cannot be undone.`}
              </p>
            </div>
            {/* The single most misread thing about this button: it is a reset,
                not a ban. Authentik still holds the identity, and the app
                provisions a fresh account for any sub it doesn't recognise. */}
            <div className="rounded-md border border-line p-3.5 space-y-1.5">
              <p className="text-sm font-medium">This does not remove their access</p>
              <p className="text-xs text-muted leading-relaxed">
                Their Authentik login still works. If they sign in again they'll get a brand-new empty MacroDaddy
                account. To keep someone out, use <span className="text-ink">Block</span> instead, or remove them in
                Authentik.
              </p>
              {accountManagerUrl && (
                <a
                  href={accountManagerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs text-accent pt-1"
                >
                  Open Authentik →
                </a>
              )}
            </div>
            <p className="text-xs text-muted px-1">
              The shared food and recipe library is not affected. A server backup is taken automatically just before
              this runs.
            </p>
            {deleteAccount.isError && (
              <p className="text-xs text-red-400 text-center">Couldn't delete that account — try again.</p>
            )}
          </div>
          <div className="px-4 pb-6 pt-2 space-y-2 shrink-0">
            <button
              onClick={() => deleteAccount.mutate(user.id, { onSuccess: onClose })}
              disabled={deleteAccount.isPending}
              className="w-full py-3 rounded-full text-sm font-semibold disabled:opacity-50"
              style={{ background: "#D95926", color: "#0B1210" }}
            >
              {deleteAccount.isPending ? "Deleting…" : `Delete ${user.name}`}
            </button>
            <button
              onClick={close}
              disabled={deleteAccount.isPending}
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
