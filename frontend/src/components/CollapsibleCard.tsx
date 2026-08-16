import { type ReactNode } from "react";
import { useExpandable } from "../hooks/useExpandable";

// The outer "History"/"Recent days" show-hide card used by WeightDetailScreen,
// ExpenditureDetailScreen, EnergyBalanceDetailScreen, ScaleWeightDetailScreen,
// and StepsDetailScreen. Was a bespoke `{open && children}` block duplicated
// per screen — pulled into one component so the animate + auto-scroll-on-
// expand behavior (see useExpandable) is consistent everywhere instead of
// drifting per copy.
export default function CollapsibleCard({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const { open, toggle, ref } = useExpandable(false);

  return (
    <div ref={ref} className={`border border-line bg-surface rounded-2xl overflow-hidden ${className}`}>
      {/* border-b here (not relying on the first MonthSection's own
          first:border-t-0-suppressed divider) — this button is no longer a
          sibling of the months in the same DOM parent (they're nested one
          level deeper, inside the grid-rows collapse wrapper), so the first
          month genuinely is `:first-child` of its own parent and would
          otherwise render with no divider under this header at all.

          It is only *painted* while open. Collapsed, the grid content has
          zero height, so this divider lands directly on the card's own
          bottom border and the two hairlines paint as one 2px edge —
          visibly thicker than every other card on the screen, which was
          reported as the card having a "thick line" along its bottom.
          Kept at 1px transparent rather than dropped so toggling only
          changes a color, never the card's height. */}
      <button onClick={toggle} aria-expanded={open} className={`w-full px-4 py-2.5 flex items-center justify-between text-left border-b transition-colors duration-150 ${open ? "border-line" : "border-transparent"}`}>
        <span className="text-[11px] tracking-widest uppercase text-muted">{label}</span>
        <span className="text-xs text-accent">{open ? "Hide" : "Show"}</span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-150 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
