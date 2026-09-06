import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, ExternalLink, Trash2 } from "lucide-react";
import BottomSheet from "./BottomSheet";
import {
  AI_PROVIDERS,
  AI_PROVIDER_KEY_URLS,
  AI_PROVIDER_LABELS,
  useAiSettings,
  useRemoveAiKey,
  useSaveAiKey,
  useTestAiKey,
  type AiProvider,
  type AiSettingsStatus,
} from "../api/settings";

function providerState(data: AiSettingsStatus, provider: AiProvider) {
  return data.providers.find((entry) => entry.provider === provider);
}

// Keep the existing password-manager-resistant key-entry surface. The value
// remains local to this mounted sheet and is cleared as soon as it is saved.
function SecretText({
  value,
  onChange,
  onEnter,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (
      element
      && (value === "" || document.activeElement !== element)
      && element.textContent !== value
    ) {
      element.textContent = value;
    }
  }, [value]);

  return (
    <div className="relative min-w-0 flex-1 rounded-md border border-line bg-surface focus-within:border-accent">
      {!value && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm text-muted">{placeholder}</span>}
      <div
        ref={ref}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="false"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        inputMode="text"
        onInput={(event) => onChange(event.currentTarget.textContent ?? "")}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onEnter();
        }}
        onPaste={(event) => {
          event.preventDefault();
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain").replace(/[\r\n]+/g, ""));
        }}
        className="min-h-9 w-full overflow-hidden whitespace-nowrap px-3 py-2 font-mono text-sm outline-none [-webkit-text-security:disc]"
      />
    </div>
  );
}

function ProviderCard({ provider, data }: { provider: AiProvider; data: AiSettingsStatus }) {
  const saveKey = useSaveAiKey();
  const testKey = useTestAiKey();
  const removeKey = useRemoveAiKey();
  const [expanded, setExpanded] = useState(false);
  const [key, setKey] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const state = providerState(data, provider);
  const configured = state?.configured ?? false;
  const invalid = state?.validationStatus === "invalid";
  const mutationError = saveError ?? testKey.error ?? removeKey.error;

  function save() {
    if (key.trim().length < 8 || saveKey.isPending) return;
    const apiKey = key.trim();
    setKey("");
    setSaveError(null);
    saveKey.mutate(
      { provider, apiKey },
      {
        onError: (error) => setSaveError(error instanceof Error ? error.message : "Couldn't save that key."),
        onSettled: () => queueMicrotask(() => saveKey.reset()),
      },
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-raised">
      <div className="flex min-h-12 items-center">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left active:bg-surface"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${configured && !invalid ? "bg-carbs" : invalid ? "bg-protein" : "bg-muted"}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{AI_PROVIDER_LABELS[provider]}</span>
            <span className="block text-[10px] text-muted">
              {invalid ? "Key is invalid" : configured ? "Key configured" : "No key configured"}
            </span>
          </span>
          {expanded
            ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={2} />
            : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={2} />}
        </button>
        <a
          href={AI_PROVIDER_KEY_URLS[provider]}
          target="_blank"
          rel="noreferrer"
          className="mr-0.5 p-3 text-accent"
          aria-label={`Manage ${AI_PROVIDER_LABELS[provider]} keys`}
        >
          <ExternalLink size={15} />
        </a>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-line px-3 py-3">
          <div className="flex gap-2">
            <SecretText
              value={key}
              onChange={setKey}
              onEnter={save}
              placeholder={configured ? "Replace key…" : "API key"}
              ariaLabel={`${AI_PROVIDER_LABELS[provider]} API key`}
            />
            <button
              type="button"
              onClick={save}
              disabled={key.trim().length < 8 || saveKey.isPending}
              className="rounded-md bg-accent px-3 text-sm font-semibold disabled:opacity-40"
              style={{ color: "#0B1210" }}
            >
              {saveKey.isPending ? "Checking…" : configured ? "Replace" : "Save"}
            </button>
          </div>
          {configured && (
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => testKey.mutate(provider)}
                disabled={testKey.isPending}
                className="text-xs text-accent disabled:opacity-40"
              >
                {testKey.isPending ? "Testing…" : "Test saved key"}
              </button>
              <button
                type="button"
                onClick={() => removeKey.mutate(provider)}
                disabled={removeKey.isPending}
                className="flex items-center gap-1 text-xs text-protein disabled:opacity-40"
              >
                <Trash2 size={13} /> Remove
              </button>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-muted">
            The central gateway encrypts this key and never returns it to MacroDaddy.
          </p>
          {mutationError && (
            <p className="text-xs text-protein">
              {typeof mutationError === "string"
                ? mutationError
                : mutationError instanceof Error
                  ? mutationError.message
                  : "Couldn't update that key."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ServerAccess({ data }: { data: AiSettingsStatus }) {
  return (
    <div className="space-y-2">
      {AI_PROVIDERS.map((provider) => {
        const configured = providerState(data, provider)?.configured ?? false;
        return (
          <div key={provider} className="flex items-center justify-between rounded-xl border border-line bg-surface-raised px-3 py-3">
            <span className="text-sm">{AI_PROVIDER_LABELS[provider]}</span>
            <span className={`flex items-center gap-1 text-xs ${configured ? "text-carbs" : "text-muted"}`}>
              {configured && <Check size={13} />} {configured ? "Available" : "Unavailable"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function AiSettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useAiSettings();
  const data = settings.data;

  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[92%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, _close, scrollDragRef) => (
        <>
          <div {...dragHandlers} className="px-4 pb-4 pt-2 text-center touch-none">
            <h2 className="text-base font-semibold">AI features</h2>
          </div>
          <div ref={scrollDragRef} className="space-y-4 overflow-y-auto p-4 pt-0 overscroll-y-contain">
            {settings.isLoading && <p className="text-sm text-muted">Checking AI access…</p>}
            {settings.error && (
              <p className="rounded-xl border border-protein/40 bg-protein/10 p-3 text-sm leading-relaxed text-protein">
                {settings.error instanceof Error ? settings.error.message : "Couldn't load AI access."}
              </p>
            )}
            {data?.policy === "server" && (
              <>
                <p className="text-xs leading-relaxed text-muted">
                  AI access for this account is provided by the central gateway. Provider choice, fallbacks, and usage limits are managed on the server.
                </p>
                <ServerAccess data={data} />
              </>
            )}
            {data?.policy === "bring_your_own_key" && (
              <>
                <p className="text-xs leading-relaxed text-muted">
                  Add one of your own provider keys to use MacroDaddy&apos;s AI features. The central gateway stores it securely; MacroDaddy never does.
                </p>
                <div className="space-y-2">
                  {AI_PROVIDERS.map((provider) => <ProviderCard key={provider} provider={provider} data={data} />)}
                </div>
              </>
            )}
            {data?.policy === "disabled" && (
              <p className="rounded-xl border border-line bg-surface-raised p-3 text-sm leading-relaxed text-muted">
                AI features are disabled for this account.
              </p>
            )}
          </div>
        </>
      )}
    </BottomSheet>
  );
}
