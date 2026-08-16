import type { ReactNode } from "react";

// Fixed-width, center-aligned number+unit column (value and unit stacked on
// their own lines, not one wide string) so every tile's description starts
// at the exact same x position regardless of how wide its own value is —
// "+0.1" / "117" / "80.2" all render at the same column width this way,
// where they didn't as a single inline string. Modeled on MacroFactor's own
// version of these screens, minus its shaded box behind the number (kept
// these tiles' plain card background instead, per explicit request).
// `valueClassName` defaults to a size tuned for short tabular numbers —
// override it for a word-shaped value (e.g. "Adaptive"/"Estimated" on the
// Expenditure screen) that needs a smaller size to fit this same fixed width
// without wrapping awkwardly.
export default function StatTile({
  value,
  unit,
  label,
  description,
  valueClassName = "text-2xl",
}: {
  value: string;
  unit?: string;
  label: ReactNode;
  description: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center gap-4 border border-line bg-surface rounded-2xl p-4">
      <div className="w-20 shrink-0 flex flex-col items-center justify-center text-center">
        <p className={`tabular font-medium tracking-tight ${value === "—" ? "text-muted" : ""} ${valueClassName}`}>{value}</p>
        {unit && <p className="text-xs text-muted mt-0.5">{unit}</p>}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] tracking-widest uppercase text-muted">{label}</p>
        <p className="text-xs text-muted mt-1">{description}</p>
      </div>
    </div>
  );
}
