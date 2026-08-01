import type { ReactNode } from "react";

// The bordered radio-card row used by every "pick one" wizard step (goal
// type, program style, diet type, calorie floor, distribution, protein
// level) — icon + title + description + a radio dot, selected state swaps
// the border/background rather than relying on the dot alone.
export default function WizardOption({
  icon,
  title,
  description,
  selected,
  onSelect,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`w-full flex items-start gap-2.5 p-3 rounded-md border text-left transition-colors ${
        selected ? "border-ink bg-surface-raised" : "border-line bg-surface"
      } ${disabled ? "opacity-40" : ""}`}
    >
      <span className="w-8 h-8 rounded-full bg-surface-raised flex items-center justify-center shrink-0 text-ink">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold leading-tight">{title}</span>
        <span className="block text-xs text-muted mt-0.5 leading-snug">{description}</span>
      </span>
      <span
        className={`w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center ${selected ? "border-ink" : "border-line"}`}
      >
        {selected && <span className="w-2 h-2 rounded-full bg-ink" />}
      </span>
    </button>
  );
}
