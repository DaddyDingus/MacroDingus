import { useState } from "react";
import BottomSheet from "./BottomSheet";
import { ApiError } from "../api/client";
import { useRenameAccount } from "../api/account";

export default function RenameAccountSheet({ currentName, onClose }: { currentName: string; onClose: () => void }) {
  const [name, setName] = useState(currentName);
  const rename = useRenameAccount();
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== currentName;

  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[85%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => {
        function submit() {
          if (!canSave || rename.isPending) return;
          rename.mutate(trimmed, { onSuccess: close });
        }
        return (
          <>
            <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line">
              <h2 className="text-base font-semibold">Rename Account</h2>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-muted">Name</label>
                <input
                  type="text"
                  autoComplete="off"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className="w-full border border-line rounded-md px-3 py-2.5 bg-transparent mt-1 focus-within:border-accent focus:outline-none"
                />
              </div>
              {rename.isError && (
                <p className="text-xs text-protein text-center">
                  {rename.error instanceof ApiError ? rename.error.message : "Something went wrong."}
                </p>
              )}
            </div>
            <div className="px-4 pb-4">
              <button
                onClick={submit}
                disabled={!canSave || rename.isPending}
                className="w-full py-3 rounded-full text-sm font-semibold disabled:opacity-40 bg-accent"
                style={{ color: "#0B1210" }}
              >
                {rename.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        );
      }}
    </BottomSheet>
  );
}
