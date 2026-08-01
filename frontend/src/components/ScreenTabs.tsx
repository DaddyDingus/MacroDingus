import type { ReactNode } from "react";

export interface ScreenTabOption<T extends string> {
  value: T;
  label: string;
  icon: ReactNode;
}

// Shared by Energy Balance (Expenditure/Calorie Targets) and Goal Progress
// (Scale Weight/Trend Weight) — both needed the same icon+label,
// underline-on-active tab header, so it lives here rather than being
// hand-rolled twice.
export default function ScreenTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ScreenTabOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex border-b border-line">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
            value === opt.value ? "border-accent text-ink" : "border-transparent text-muted"
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
