import { useState } from "react";
import { Check, ExternalLink, Trash2 } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { ApiError } from "../api/client";
import { useAiSettings, useRemoveAiKey, useSaveAiKey } from "../api/settings";

export default function AiSettingsSheet({ onClose }: { onClose: () => void }) {
  const status = useAiSettings();
  const save = useSaveAiKey();
  const remove = useRemoveAiKey();
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const canSave = apiKey.trim().length >= 20 && !save.isPending;

  function submit() {
    if (!canSave) return;
    setSaved(false);
    save.mutate(apiKey, {
      onSuccess: () => {
        setApiKey("");
        setSaved(true);
      },
    });
  }

  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[90%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers) => (
        <>
          <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line">
            <h2 className="text-base font-semibold">AI Features</h2>
          </div>
          <div className="p-4 space-y-4 overflow-y-auto">
            <div className="rounded-xl border border-line bg-surface-raised px-3.5 py-3">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${status.data?.configured ? "bg-carbs" : "bg-muted"}`} />
                <p className="text-sm font-medium">
                  {status.isPending
                    ? "Checking configuration…"
                    : status.data?.source === "account"
                    ? "Your API key is configured"
                    : status.data?.source === "environment"
                    ? "This server provides a shared API key"
                    : "AI features are not configured"}
                </p>
              </div>
              <p className="text-xs text-muted mt-1.5 leading-relaxed">
                Your key pays for meal descriptions, label scans, recipe imports, photo comparisons, and check-in summaries.
              </p>
            </div>

            <div>
              <label className="text-xs text-muted">
                {status.data?.source === "account" ? "Replace your Anthropic API key" : "Anthropic API key"}
              </label>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setSaved(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="sk-ant-…"
                className="w-full border border-line rounded-md px-3 py-2.5 bg-transparent mt-1 focus:border-accent focus:outline-none font-mono text-sm"
              />
              <p className="text-[11px] text-muted/80 mt-1.5 leading-relaxed">
                The key is validated with Anthropic, stored only on this server, and never shown again. AI photos and text are sent to Anthropic when you use those features.
              </p>
            </div>

            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-accent"
            >
              Create or manage an Anthropic key
              <ExternalLink size={12} />
            </a>

            {save.isError && (
              <p className="text-xs text-protein text-center">
                {save.error instanceof ApiError ? save.error.message : "Couldn't save that key."}
              </p>
            )}
            {saved && (
              <p className="text-xs text-carbs text-center flex items-center justify-center gap-1.5">
                <Check size={13} /> API key saved and ready to use.
              </p>
            )}

            <button
              onClick={submit}
              disabled={!canSave}
              className="w-full py-3 rounded-full text-sm font-semibold disabled:opacity-40 bg-accent"
              style={{ color: "#0B1210" }}
            >
              {save.isPending ? "Validating…" : status.data?.source === "account" ? "Replace Key" : "Save Key"}
            </button>

            {status.data?.source === "account" && (
              <button
                onClick={() => {
                  setSaved(false);
                  remove.mutate();
                }}
                disabled={remove.isPending}
                className="w-full py-2.5 text-sm text-protein flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <Trash2 size={14} />
                {remove.isPending ? "Removing…" : "Remove My Key"}
              </button>
            )}
          </div>
        </>
      )}
    </BottomSheet>
  );
}
