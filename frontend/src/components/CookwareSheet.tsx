import { useState } from "react";
import { Check, CookingPot, Pencil, Plus, Trash2, X } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { ApiError } from "../api/client";
import DecimalInput from "./DecimalInput";
import {
  type CookwareItem,
  useCookware,
  useCreateCookware,
  useDeleteCookware,
  useUpdateCookware,
} from "../api/cookware";

export default function CookwareSheet({
  onClose,
  selectedId,
  onSelect,
}: {
  onClose: () => void;
  selectedId?: string | null;
  onSelect?: (item: CookwareItem | null) => void;
}) {
  const cookware = useCookware();
  const create = useCreateCookware();
  const update = useUpdateCookware();
  const remove = useDeleteCookware();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const isPicker = !!onSelect;
  const pending = create.isPending || update.isPending;
  const weightGrams = Number(weight);
  const canSave = name.trim().length > 0 && weightGrams > 0 && weightGrams <= 100_000 && !pending;
  const mutationError = create.error ?? update.error;

  function clearForm() {
    setEditingId(null);
    setName("");
    setWeight("");
  }

  function beginEdit(item: CookwareItem) {
    setEditingId(item.id);
    setName(item.name);
    setWeight(String(item.weightGrams));
    setConfirmDeleteId(null);
  }

  function submit(close: () => void) {
    if (!canSave) return;
    const input = { name: name.trim(), weightGrams };
    if (editingId) {
      const id = editingId;
      update.mutate(
        { id, ...input },
        {
          onSuccess: (updated) => {
            if (selectedId === id) onSelect?.(updated);
            clearForm();
          },
        },
      );
      return;
    }
    create.mutate(input, {
      onSuccess: (created) => {
        clearForm();
        if (onSelect) {
          onSelect(created);
          close();
        }
      },
    });
  }

  return (
    <BottomSheet onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-h-[90%] bg-surface rounded-t-xl border-t border-line">
      {(dragHandlers, close) => (
        <>
          <div {...dragHandlers} className="px-4 pt-2 pb-4 text-center border-b border-line">
            <h2 className="text-base font-semibold">Pots &amp; dishes</h2>
            <p className="text-xs text-muted mt-1">
              {isPicker ? "Choose what the finished recipe was weighed in." : "Save empty weights for recipe calculations."}
            </p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {isPicker && (
              <button
                type="button"
                onClick={() => {
                  onSelect(null);
                  close();
                }}
                className="w-full flex items-center gap-3 px-4 py-3 border-b border-line/60 text-left active:bg-surface-raised"
              >
                <span className="w-9 h-9 rounded-xl bg-surface-raised flex items-center justify-center text-muted shrink-0">
                  <X size={17} strokeWidth={2} />
                </span>
                <span className="flex-1 text-sm">No pot or dish</span>
                {!selectedId && <Check size={18} className="text-accent shrink-0" />}
              </button>
            )}

            {cookware.isPending && <p className="px-4 py-4 text-sm text-muted">Loading…</p>}
            {!cookware.isPending && cookware.data?.length === 0 && (
              <p className="px-4 py-4 text-sm text-muted border-b border-line/60">
                No saved pots or dishes yet.
              </p>
            )}
            {cookware.data?.map((item) => (
              <div key={item.id} className="flex items-center border-b border-line/60 active:bg-surface-raised">
                <button
                  type="button"
                  onClick={() => {
                    if (onSelect) {
                      onSelect(item);
                      close();
                    } else {
                      beginEdit(item);
                    }
                  }}
                  className="flex-1 min-w-0 flex items-center gap-3 pl-4 py-3 text-left"
                >
                  <span className="w-9 h-9 rounded-xl bg-surface-raised flex items-center justify-center text-muted shrink-0">
                    <CookingPot size={17} strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">{item.name}</span>
                    <span className="block text-xs text-muted tabular">{Math.round(item.weightGrams).toLocaleString()} g empty</span>
                  </span>
                  {selectedId === item.id && <Check size={18} className="text-accent shrink-0" />}
                </button>
                <button
                  type="button"
                  onClick={() => beginEdit(item)}
                  aria-label={`Edit ${item.name}`}
                  className="w-11 h-11 flex items-center justify-center text-muted active:text-white shrink-0"
                >
                  <Pencil size={15} strokeWidth={2} />
                </button>
                {confirmDeleteId === item.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      remove.mutate(item.id, {
                        onSuccess: () => {
                          if (selectedId === item.id) onSelect?.(null);
                          if (editingId === item.id) clearForm();
                          setConfirmDeleteId(null);
                        },
                      });
                    }}
                    className="h-11 px-3 text-xs font-medium text-protein shrink-0"
                  >
                    Delete?
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(item.id)}
                    aria-label={`Delete ${item.name}`}
                    className="w-11 h-11 flex items-center justify-center text-muted active:text-protein shrink-0"
                  >
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                )}
              </div>
            ))}

            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{editingId ? "Edit pot or dish" : "Add a pot or dish"}</p>
                {editingId && (
                  <button type="button" onClick={clearForm} className="text-xs font-medium text-accent">Cancel edit</button>
                )}
              </div>
              <label className="block">
                <span className="text-xs text-muted">Name</span>
                <input
                  type="search"
                  autoComplete="off"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && submit(close)}
                  placeholder="e.g. Large glass baking dish"
                  className="w-full border border-line rounded-md px-3 py-2.5 bg-transparent mt-1 focus:border-accent focus:outline-none text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted">Empty weight</span>
                <div className="flex items-center border border-line rounded-md px-3 bg-transparent mt-1 focus-within:border-accent">
                  <DecimalInput
                    label="Empty cookware weight"
                    value={weight}
                    onChange={setWeight}
                    placeholder="0"
                    className="tabular min-w-0 flex-1 py-2.5 bg-transparent text-left focus:outline-none text-sm"
                  />
                  <span className="text-xs text-muted">g</span>
                </div>
              </label>
              {mutationError && (
                <p className="text-xs text-protein text-center">
                  {mutationError instanceof ApiError ? mutationError.message : "Couldn't save that pot or dish."}
                </p>
              )}
              <button
                type="button"
                onClick={() => submit(close)}
                disabled={!canSave}
                className="w-full py-3 rounded-full text-sm font-semibold disabled:opacity-40 bg-accent flex items-center justify-center gap-2"
                style={{ color: "#0B1210" }}
              >
                {!editingId && <Plus size={15} strokeWidth={2.5} />}
                {pending ? "Saving…" : editingId ? "Save changes" : "Add pot or dish"}
              </button>
            </div>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
