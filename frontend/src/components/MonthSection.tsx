import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// One collapsible month inside a History card. Every detail screen's history
// list is grouped by month and had a single all-or-nothing toggle above the
// whole thing — fine when a list was one row per weigh-in, bad once Weight
// Trend's went dense (one row per calendar day: up to 31 a month, 365 a year).
// Deliberately NOT one card per month: each screen is a fixed sequence of
// cards, and a dozen sibling month cards would read as a dozen equally
// weighted sections rather than one thing called History.
//
// The border lives on the wrapper, not the header, so `first:` resolves
// against the sibling months. Screens whose card has its own "History
// Show/Hide" button above the list therefore keep a divider on every month
// (no month is the card's first child), while screens that start straight
// into months don't double up on the card's own top border.
export default function MonthSection({
  label,
  summary,
  defaultOpen = false,
  children,
}: {
  label: string;
  // Short right-aligned detail that stays visible while collapsed, so a shut
  // month isn't just a name.
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-line first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-4 py-2 bg-surface-raised flex items-center justify-between gap-3 text-left"
      >
        <span className="text-xs text-muted">{label}</span>
        <span className="flex items-center gap-2 shrink-0">
          {summary && <span className="tabular text-xs text-muted/70">{summary}</span>}
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        </span>
      </button>
      {open && children}
    </div>
  );
}
