import { useEffect, useRef, useState } from "react";
import BottomSheet from "./BottomSheet";
import DecimalKeypad from "./DecimalKeypad";

// Input-shaped trigger for the shared on-page decimal keypad. Numeric values
// stay as strings while being edited so trailing decimal points and an empty
// value behave exactly like a native input without invoking the phone keyboard.
export default function DecimalInput({
  value,
  onChange,
  label = "Enter value",
  placeholder,
  className = "",
  disabled = false,
  allowDecimal = true,
  allowNegative = false,
  autoOpen = false,
  onDone,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowDecimal?: boolean;
  allowNegative?: boolean;
  autoOpen?: boolean;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(autoOpen && !disabled);
  const [allSelected, setAllSelected] = useState(autoOpen && Boolean(value));
  const pendingOpenCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => pendingOpenCleanupRef.current?.(), []);

  function showKeypad() {
    pendingOpenCleanupRef.current?.();
    pendingOpenCleanupRef.current = null;
    setAllSelected(Boolean(value));
    setOpen(true);
  }

  function openKeypad() {
    if (disabled) return;
    const active = document.activeElement;
    const ownsNativeKeyboard = active instanceof HTMLInputElement
      || active instanceof HTMLTextAreaElement
      || (active instanceof HTMLElement && active.isContentEditable);

    if (!ownsNativeKeyboard) {
      showKeypad();
      return;
    }

    // A button tap does not reliably dismiss Android's IME from the text
    // input that was focused immediately beforehand. Opening this keypad at
    // the same time then nests a BottomSheet inside a visual viewport which
    // is still shortened by the native keyboard: the parent dims, while the
    // value display and most keys stay hidden behind the IME. Blur first and
    // wait for the viewport's keyboard-close animation to settle before
    // mounting the custom keypad.
    const startedAt = performance.now();
    const viewport = window.visualViewport;
    let settleTimer = 0;
    let fallbackTimer = 0;

    function cleanup() {
      window.clearTimeout(settleTimer);
      window.clearTimeout(fallbackTimer);
      viewport?.removeEventListener("resize", scheduleAfterSettle);
    }

    function finish() {
      cleanup();
      pendingOpenCleanupRef.current = null;
      setAllSelected(Boolean(value));
      setOpen(true);
    }

    function scheduleAfterSettle() {
      window.clearTimeout(settleTimer);
      const elapsed = performance.now() - startedAt;
      settleTimer = window.setTimeout(finish, Math.max(90, 220 - elapsed));
    }

    pendingOpenCleanupRef.current = cleanup;
    viewport?.addEventListener("resize", scheduleAfterSettle);
    // Hardware keyboards and browsers without VisualViewport produce no
    // resize event; this remains a short bounded handoff in that case.
    fallbackTimer = window.setTimeout(finish, 420);
    active.blur();
    scheduleAfterSettle();
  }

  function tapDigit(digit: string) {
    onChange(allSelected || value === "0" || value === "-0" ? `${value.startsWith("-") ? "-" : ""}${digit}` : value + digit);
    setAllSelected(false);
  }

  function tapDecimal() {
    if (!allowDecimal) return;
    if (allSelected) onChange(value.startsWith("-") ? "-0." : "0.");
    else if (!value.includes(".")) onChange(value === "" || value === "-" ? `${value}0.` : `${value}.`);
    setAllSelected(false);
  }

  function tapBackspace() {
    onChange(allSelected ? "" : value.slice(0, -1));
    setAllSelected(false);
  }

  function toggleSign() {
    if (!allowNegative) return;
    onChange(value.startsWith("-") ? value.slice(1) : `-${value}`);
    setAllSelected(false);
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={openKeypad}
        aria-label={label}
        aria-expanded={open}
        className={className}
      >
        {value || <span className="text-muted/50">{placeholder ?? ""}</span>}
      </button>
      {open && (
        <BottomSheet
          onClose={() => {
            setOpen(false);
            onDone?.();
          }}
          backdropClassName="bg-black/60"
          panelClassName="bg-dashboardBg rounded-t-2xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
        >
          {(dragHandlers, close) => (
            <>
              <div {...dragHandlers} className="px-4 pb-3 flex items-center justify-between gap-3 shrink-0 touch-none">
                <span className="text-sm font-medium text-white">{label}</span>
                <button
                  type="button"
                  onClick={close}
                  className="px-3 py-1.5 rounded-full bg-white/10 text-sm font-semibold text-white active:bg-white/20"
                >
                  Done
                </button>
              </div>
              <div className="px-4 pb-4">
                <div className="min-h-14 mb-3 rounded-xl border border-accent bg-surface px-4 flex items-center justify-end text-2xl tabular text-white">
                  {value ? (
                    allSelected ? <span className="bg-accent/30 rounded px-1">{value}</span> : value
                  ) : (
                    <span className="text-muted/50">{placeholder ?? "0"}</span>
                  )}
                  <span className="caret-blink w-[2px] h-[1.1em] bg-white ml-1 shrink-0" />
                </div>
                {allowNegative && (
                  <button
                    type="button"
                    onClick={toggleSign}
                    className="w-full h-10 mb-2 rounded-xl bg-white/[0.03] text-sm font-medium text-white/70 active:bg-white/[0.1]"
                  >
                    Change sign (+/−)
                  </button>
                )}
                <DecimalKeypad
                  onDigit={tapDigit}
                  onDecimal={tapDecimal}
                  onBackspace={tapBackspace}
                  decimalDisabled={!allowDecimal}
                  keyHeightClassName="h-12"
                />
              </div>
            </>
          )}
        </BottomSheet>
      )}
    </>
  );
}
