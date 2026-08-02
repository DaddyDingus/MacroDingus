import { useState } from "react";
import BottomSheet from "./BottomSheet";
import { ApiError } from "../api/client";
import { useChangePassword } from "../api/account";

export default function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const changePassword = useChangePassword();

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSave = currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;

  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => {
        function submit() {
          if (!canSave || changePassword.isPending) return;
          changePassword.mutate({ currentPassword, newPassword }, { onSuccess: close });
        }
        return (
          <>
            <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line">
              <h2 className="text-base font-semibold">Change Password</h2>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-muted">Current password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className="w-full border border-line rounded-md px-3 py-2.5 bg-transparent mt-1 focus-within:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted">New password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className="w-full border border-line rounded-md px-3 py-2.5 bg-transparent mt-1 focus-within:border-accent focus:outline-none"
                />
                <p className="text-[11px] text-muted/70 mt-1">At least 8 characters.</p>
              </div>
              <div>
                <label className="text-xs text-muted">Confirm new password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className="w-full border border-line rounded-md px-3 py-2.5 bg-transparent mt-1 focus-within:border-accent focus:outline-none"
                />
                {mismatch && <p className="text-[11px] text-protein mt-1">Passwords don't match.</p>}
              </div>
              {changePassword.isError && (
                <p className="text-xs text-protein text-center">
                  {changePassword.error instanceof ApiError ? changePassword.error.message : "Something went wrong."}
                </p>
              )}
            </div>
            <div className="px-4 pb-4">
              <button
                onClick={submit}
                disabled={!canSave || changePassword.isPending}
                className="w-full py-3 rounded-full text-sm font-semibold disabled:opacity-40 bg-accent"
                style={{ color: "#0B1210" }}
              >
                {changePassword.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        );
      }}
    </BottomSheet>
  );
}
