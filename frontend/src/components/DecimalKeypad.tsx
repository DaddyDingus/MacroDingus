import { Delete } from "lucide-react";

let lastVibrateTime = 0;

function triggerKeyHaptic(durationMs: number) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    const now = Date.now();
    if (now - lastVibrateTime > 80) {
      navigator.vibrate(durationMs);
      lastVibrateTime = now;
    }
  }
}

// Shared decimal-only keypad for short quantity/measurement entry. Keeping
// this on-page gives these controls a predictable height across devices and
// avoids resizing the visual viewport for an interaction that only needs
// digits, one decimal separator, and backspace.
export default function DecimalKeypad({
  onDigit,
  onDecimal,
  onBackspace,
  keyHeightClassName = "h-[58px]",
  decimalDisabled = false,
}: {
  onDigit: (digit: string) => void;
  onDecimal: () => void;
  onBackspace: () => void;
  keyHeightClassName?: string;
  decimalDisabled?: boolean;
}) {
  const numberKeyClass = `${keyHeightClassName} rounded-2xl bg-white/[0.07] flex items-center justify-center text-2xl font-medium text-white active:bg-white/[0.15] active:scale-[0.95] transition-all duration-75 select-none`;
  const utilityKeyClass = `${keyHeightClassName} rounded-2xl bg-white/[0.03] flex items-center justify-center text-2xl font-medium text-white/70 active:bg-white/[0.1] active:scale-[0.95] transition-all duration-75 select-none`;

  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-2">
      {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((digit) => (
        <button
          key={digit}
          type="button"
          onTouchStart={() => triggerKeyHaptic(10)}
          onClick={() => onDigit(digit)}
          className={numberKeyClass}
        >
          {digit}
        </button>
      ))}
      <button
        type="button"
        disabled={decimalDisabled}
        onTouchStart={() => !decimalDisabled && triggerKeyHaptic(10)}
        onClick={onDecimal}
        className={`${utilityKeyClass} disabled:opacity-20 disabled:active:scale-100`}
      >
        .
      </button>
      <button type="button" onTouchStart={() => triggerKeyHaptic(10)} onClick={() => onDigit("0")} className={numberKeyClass}>
        0
      </button>
      <button
        type="button"
        onTouchStart={() => triggerKeyHaptic(12)}
        onClick={onBackspace}
        aria-label="Backspace"
        className={utilityKeyClass}
      >
        <Delete size={26} strokeWidth={1.5} />
      </button>
    </div>
  );
}
