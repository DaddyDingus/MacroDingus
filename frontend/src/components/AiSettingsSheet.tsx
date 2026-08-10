import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, ExternalLink, Trash2 } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { ApiError } from "../api/client";
import {
  useAiSettings,
  useRemoveAiKey,
  useSaveAiKey,
  useSaveAiTask,
  type AiProvider,
  type AiTaskId,
} from "../api/settings";

const PROVIDERS: AiProvider[] = ["anthropic", "openai", "gemini"];
const PROVIDER_LABELS: Record<AiProvider, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Google Gemini" };

type TaskDraft = Record<AiTaskId, { provider: AiProvider; model: string }>;
type PickerState = { task: AiTaskId; kind: "provider" | "model" };

// Chrome's credential heuristics can ignore autocomplete/data-manager hints
// and show its password strip for any input near API-key fields. This remains
// a normal single-line keyboard-editable surface, but it is not an input or
// textarea, so password managers have no credential field to attach to.
function EditableText({
  value,
  onChange,
  onEnter,
  placeholder,
  ariaLabel,
  masked = false,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  placeholder: string;
  ariaLabel: string;
  masked?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (element && document.activeElement !== element && element.textContent !== value) element.textContent = value;
  }, [value]);

  return (
    <div className={`relative min-w-0 ${className}`}>
      {!value && <span className="absolute inset-y-0 left-3 flex items-center text-muted pointer-events-none font-mono text-sm">{placeholder}</span>}
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
          onEnter?.();
        }}
        onPaste={(event) => {
          event.preventDefault();
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain").replace(/[\r\n]+/g, ""));
        }}
        className={`min-h-9 w-full overflow-hidden whitespace-nowrap px-3 py-2 outline-none font-mono text-sm ${masked ? "[-webkit-text-security:disc]" : ""}`}
      />
    </div>
  );
}

function SelectionSheet({
  title,
  options,
  selected,
  allowCustom = false,
  onSelect,
  onCustom,
  onClose,
}: {
  title: string;
  options: { value: string; label: string; recommended?: boolean; discovered?: boolean }[];
  selected: string;
  allowCustom?: boolean;
  onSelect: (value: string) => void;
  onCustom?: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/60" panelClassName="max-h-[70%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-1 pb-2.5 border-b border-line shrink-0 touch-none">
            <h3 className="text-sm font-medium">{title}</h3>
          </div>
          <div className="overflow-y-auto p-3">
            <div className="rounded-xl bg-dashboardCard overflow-hidden divide-y divide-dashboardDivider">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onSelect(option.value);
                    close();
                  }}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left active:bg-surface-raised"
                >
                  <span className="min-w-0 flex items-center gap-2">
                    <span className={`text-sm truncate ${option.value === selected ? "text-accent" : ""}`}>{option.label}</span>
                    {option.recommended && (
                      <span className="text-[9px] uppercase tracking-wide text-muted bg-line/30 rounded-full px-1.5 py-0.5 shrink-0">Recommended</span>
                    )}
                    {!option.recommended && option.discovered && (
                      <span className="text-[9px] uppercase tracking-wide text-muted/80 border border-line rounded-full px-1.5 py-0.5 shrink-0">Available</span>
                    )}
                  </span>
                  {option.value === selected && <Check className="w-4 h-4 text-accent shrink-0" strokeWidth={2} />}
                </button>
              ))}
              {allowCustom && (
                <button
                  type="button"
                  onClick={() => {
                    onCustom?.();
                    close();
                  }}
                  className="w-full px-4 py-3 text-left active:bg-surface-raised"
                >
                  <span className="block text-sm text-accent">Use an unlisted model ID…</span>
                  <span className="block text-[10px] text-muted mt-0.5">For a compatible model that is not in the available list.</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

function UnsavedChangesSheet({ onClose, onDiscard }: { onClose: () => void; onDiscard: () => void }) {
  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/65" panelClassName="bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-1 pb-3 text-center border-b border-line touch-none">
            <h3 className="text-base font-semibold">Unsaved changes</h3>
            <p className="text-xs text-muted mt-1">Your provider key or model changes haven’t been saved.</p>
          </div>
          <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] grid gap-2">
            <button type="button" onClick={close} className="w-full py-3 rounded-full bg-accent text-sm font-semibold" style={{ color: "#0B1210" }}>
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => {
                close();
                onDiscard();
              }}
              className="w-full py-3 rounded-full border border-protein/60 text-protein text-sm font-semibold"
            >
              Discard changes
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

export default function AiSettingsSheet({ onClose }: { onClose: () => void }) {
  const status = useAiSettings();
  const saveKey = useSaveAiKey();
  const removeKey = useRemoveAiKey();
  const saveTask = useSaveAiTask();
  const [keys, setKeys] = useState<Record<AiProvider, string>>({ anthropic: "", openai: "", gemini: "" });
  const [savedKey, setSavedKey] = useState<AiProvider | null>(null);
  const [drafts, setDrafts] = useState<Partial<TaskDraft>>({});
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [customModelTasks, setCustomModelTasks] = useState<Partial<Record<AiTaskId, boolean>>>({});
  const [expandedProvider, setExpandedProvider] = useState<AiProvider | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [savedAll, setSavedAll] = useState(false);
  const draftsInitialized = useRef(false);
  const allowClose = useRef(false);

  useEffect(() => {
    if (!status.data || draftsInitialized.current) return;
    draftsInitialized.current = true;
    setDrafts(Object.fromEntries(status.data.tasks.map((task) => [task.id, { provider: task.provider, model: task.model }])) as TaskDraft);
  }, [status.data]);

  const changedTasks = status.data?.tasks.filter((task) => {
    const draft = drafts[task.id];
    return draft && (draft.provider !== task.provider || draft.model.trim() !== task.model);
  }) ?? [];
  const unsavedKeyProviders = PROVIDERS.filter((provider) => keys[provider].trim().length > 0);
  const hasUnsavedChanges = changedTasks.length > 0 || unsavedKeyProviders.length > 0;
  const hasInvalidKey = unsavedKeyProviders.some((provider) => keys[provider].trim().length < 20);

  function submitKey(provider: AiProvider) {
    const apiKey = keys[provider].trim();
    if (apiKey.length < 20 || saveKey.isPending) return;
    setSavedKey(null);
    setSavedAll(false);
    saveKey.mutate({ provider, apiKey }, {
      onSuccess: () => {
        setKeys((current) => ({ ...current, [provider]: "" }));
        setSavedKey(provider);
      },
    });
  }

  function updateDraft(task: AiTaskId, patch: Partial<{ provider: AiProvider; model: string }>) {
    setSavedAll(false);
    setDrafts((current) => {
      const existing = current[task];
      if (!existing) return current;
      const next = { ...existing, ...patch };
      if (patch.provider && patch.provider !== existing.provider) {
        next.model = status.data?.tasks.find((candidate) => candidate.id === task)?.recommendedModels?.[patch.provider]
          ?? status.data?.providers[patch.provider].models[0]
          ?? "";
      }
      return { ...current, [task]: next };
    });
  }

  async function saveAllChanges() {
    if (!hasUnsavedChanges || hasInvalidKey || savingAll) return;
    const taskUpdates = changedTasks.flatMap((task) => {
      const draft = drafts[task.id];
      return draft ? [{ task: task.id, ...draft }] : [];
    });
    setSavingAll(true);
    setSavedAll(false);
    try {
      for (const provider of unsavedKeyProviders) {
        await saveKey.mutateAsync({ provider, apiKey: keys[provider].trim() });
        setKeys((current) => ({ ...current, [provider]: "" }));
        setSavedKey(provider);
      }
      for (const update of taskUpdates) await saveTask.mutateAsync(update);
      setSavedAll(true);
    } catch {
      // The mutation hooks expose the provider/task-specific API message in
      // the sheet; leave every unsaved draft intact so it can be corrected.
    } finally {
      setSavingAll(false);
    }
  }

  return (
    <BottomSheet
      onClose={onClose}
      onBeforeClose={() => {
        if (allowClose.current || !hasUnsavedChanges) return true;
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        setShowDiscardConfirm(true);
        return false;
      }}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[92%] bg-surface rounded-t-xl border-t border-line"
    >
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line">
            <h2 className="text-base font-semibold">AI Providers</h2>
          </div>
          <div className="p-4 space-y-5 overflow-y-auto">
            <p className="text-xs text-muted leading-relaxed">
              Add one or more provider keys, then choose the provider and model for each AI feature. Keys stay on this server and are never returned to the app.
            </p>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">API keys</h3>
              {PROVIDERS.map((provider) => {
                const details = status.data?.providers[provider];
                const key = keys[provider];
                const canSave = key.trim().length >= 20 && !saveKey.isPending;
                const expanded = expandedProvider === provider;
                return (
                  <div key={provider} className="rounded-xl border border-line bg-surface-raised overflow-hidden">
                    <div className="flex items-center min-h-12">
                      <button
                        type="button"
                        onClick={() => setExpandedProvider(expanded ? null : provider)}
                        aria-expanded={expanded}
                        className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 text-left active:bg-surface"
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${details?.configured ? "bg-carbs" : "bg-muted"}`} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium">{details?.label ?? PROVIDER_LABELS[provider]}</span>
                          <span className="block text-[10px] text-muted">
                            {details?.source === "account"
                              ? "Key configured"
                              : details?.source === "environment"
                              ? "Shared server key"
                              : "No key configured"}
                          </span>
                        </span>
                        {expanded
                          ? <ChevronUp className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={2} />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={2} />}
                      </button>
                      {details?.keyUrl && (
                        <a href={details.keyUrl} target="_blank" rel="noreferrer" className="p-3 mr-0.5 text-accent" aria-label={`Manage ${details.label} keys`}>
                          <ExternalLink size={15} />
                        </a>
                      )}
                    </div>

                    {expanded && (
                      <div className="border-t border-line px-3 py-3 space-y-2">
                        <div className="flex gap-2">
                          <EditableText
                            value={key}
                            onChange={(value) => {
                              setKeys((current) => ({ ...current, [provider]: value }));
                              setSavedKey(null);
                              setSavedAll(false);
                            }}
                            onEnter={() => submitKey(provider)}
                            placeholder={details?.keyPlaceholder ?? "API key"}
                            ariaLabel={`${details?.label ?? PROVIDER_LABELS[provider]} API key`}
                            masked
                            className="flex-1 border border-line rounded-md focus-within:border-accent bg-surface"
                          />
                          <button
                            onClick={() => submitKey(provider)}
                            disabled={!canSave}
                            className="px-3 rounded-md text-sm font-semibold disabled:opacity-40 bg-accent"
                            style={{ color: "#0B1210" }}
                          >
                            {saveKey.isPending && saveKey.variables?.provider === provider ? "Checking…" : details?.source === "account" ? "Replace" : "Save"}
                          </button>
                        </div>

                        <div className="flex items-center justify-between min-h-5">
                          {savedKey === provider ? (
                            <p className="text-xs text-carbs flex items-center gap-1.5"><Check size={13} /> Key saved and ready.</p>
                          ) : <span />}
                          {details?.source === "account" && (
                            <button
                              onClick={() => {
                                setSavedKey(null);
                                removeKey.mutate(provider);
                              }}
                              disabled={removeKey.isPending}
                              className="text-xs text-protein flex items-center gap-1.5 disabled:opacity-40"
                            >
                              <Trash2 size={13} /> Remove key
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {saveKey.isError && (
                <p className="text-xs text-protein text-center">
                  {saveKey.error instanceof ApiError ? saveKey.error.message : "Couldn't save that key."}
                </p>
              )}
            </section>

            <section className="space-y-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Models by task</h3>
                <p className="text-[11px] text-muted mt-1">Available models refresh automatically from configured providers about once a day.</p>
              </div>
              {status.data?.tasks.map((task) => {
                const draft = drafts[task.id];
                if (!draft) return null;
                const providerDetails = status.data.providers[draft.provider];
                return (
                  <div key={task.id} className="rounded-xl border border-line p-3 space-y-2.5">
                    <div className="flex items-start gap-2">
                      <span className={`w-2 h-2 rounded-full mt-1.5 ${providerDetails.configured ? "bg-carbs" : "bg-protein"}`} />
                      <div>
                        <p className="text-sm font-medium">{task.label}</p>
                        <p className="text-[11px] text-muted leading-relaxed mt-0.5">{task.description}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2">
                      <button
                        type="button"
                        onClick={() => setPicker({ task: task.id, kind: "provider" })}
                        className="min-w-0 flex items-center justify-between gap-1.5 border border-line rounded-md px-2.5 py-2 bg-surface text-sm text-left active:bg-surface-raised"
                      >
                        <span className="truncate">{providerDetails.label}</span>
                        <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPicker({ task: task.id, kind: "model" })}
                        className="min-w-0 flex items-center justify-between gap-1.5 border border-line rounded-md px-2.5 py-2 bg-surface text-left active:bg-surface-raised"
                        aria-label={`${task.label} model`}
                      >
                        <span className="font-mono text-xs truncate">{draft.model}</span>
                        <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" strokeWidth={2} />
                      </button>
                    </div>
                    {customModelTasks[task.id] && (
                      <div>
                        <EditableText
                          value={draft.model}
                          onChange={(model) => updateDraft(task.id, { model })}
                          placeholder="Unlisted model ID"
                          ariaLabel={`${task.label} unlisted model ID`}
                          className="focus-within:border-accent border border-line rounded-md bg-surface [&_[role=textbox]]:text-xs"
                        />
                        <p className="text-[10px] text-muted mt-1 px-0.5">Enter the exact API model identifier supplied by {providerDetails.label}.</p>
                      </div>
                    )}
                    {!providerDetails.configured && <p className="text-[11px] text-protein">Add a {providerDetails.label} key above to use this task.</p>}
                  </div>
                );
              })}
              {saveTask.isError && (
                <p className="text-xs text-protein text-center">
                  {saveTask.error instanceof ApiError ? saveTask.error.message : "Couldn't save that model selection."}
                </p>
              )}
            </section>

            <p className="text-[11px] text-muted/80 leading-relaxed">
              Meal text and any photos used by an AI feature are sent only to the provider selected for that task. API usage is billed by that provider.
            </p>
          </div>

          <div className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {hasInvalidKey && <p className="text-[11px] text-protein text-center mb-2">Finish entering the API key before saving.</p>}
            <button
              type="button"
              onClick={saveAllChanges}
              disabled={!hasUnsavedChanges || hasInvalidKey || savingAll}
              className="w-full py-3 rounded-full bg-accent text-sm font-semibold disabled:opacity-35"
              style={{ color: "#0B1210" }}
            >
              {savingAll ? "Saving…" : savedAll && !hasUnsavedChanges ? "Saved" : "Save changes"}
            </button>
          </div>

          {picker && status.data && drafts[picker.task] && (() => {
            const task = status.data.tasks.find((candidate) => candidate.id === picker.task);
            const draft = drafts[picker.task]!;
            if (!task) return null;
            if (picker.kind === "provider") {
              return (
                <SelectionSheet
                  title={`${task.label} provider`}
                  options={PROVIDERS.map((provider) => ({ value: provider, label: status.data.providers[provider].label }))}
                  selected={draft.provider}
                  onSelect={(value) => {
                    updateDraft(task.id, { provider: value as AiProvider });
                    setCustomModelTasks((current) => ({ ...current, [task.id]: false }));
                  }}
                  onClose={() => setPicker(null)}
                />
              );
            }
            return (
              <SelectionSheet
                title={`${task.label} model`}
                options={status.data.providers[draft.provider].models.map((model) => ({
                  value: model,
                  label: model,
                  recommended: model === task.recommendedModels?.[draft.provider],
                  discovered: status.data.providers[draft.provider].discoveredModels?.includes(model),
                }))}
                selected={draft.model}
                allowCustom
                onSelect={(model) => {
                  updateDraft(task.id, { model });
                  setCustomModelTasks((current) => ({ ...current, [task.id]: false }));
                }}
                onCustom={() => setCustomModelTasks((current) => ({ ...current, [task.id]: true }))}
                onClose={() => setPicker(null)}
              />
            );
          })()}

          {showDiscardConfirm && (
            <UnsavedChangesSheet
              onClose={() => setShowDiscardConfirm(false)}
              onDiscard={() => {
                allowClose.current = true;
                close();
              }}
            />
          )}
        </>
      )}
    </BottomSheet>
  );
}
