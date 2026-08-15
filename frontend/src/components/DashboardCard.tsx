import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { staggerStyle } from "../lib/stagger";

// The one tile shape for every Dashboard bento card: bold title, a muted
// subtitle naming the window ("Last 7 days", "42 days", "avg g/day, 7d"),
// the content itself (chart, habit grid, or progress bar), a hairline
// divider, then a value/unit/chevron footer. Every tile in the catalog maps
// onto this same shape, so it replaced two separate card components
// (a label-first one for nutrition tiles, a title-first one for everything
// else) that only existed because the layouts hadn't been unified yet.
export default function DashboardCard({
  title,
  subtitle,
  value,
  unit,
  onClick,
  staggerIndex,
  mediaLayout = false,
  children,
}: {
  title: string;
  subtitle: string;
  value: ReactNode;
  unit?: string;
  onClick: () => void;
  staggerIndex?: number;
  mediaLayout?: boolean;
  children?: ReactNode;
}) {
  const style = staggerIndex !== undefined ? staggerStyle(staggerIndex) : undefined;
  return (
    <button
      onClick={onClick}
      style={style}
      // gap-2, not gap-3: the card is a fixed square, so all three gaps are
      // paid for out of the one flex-1 child — the media box. On a narrow
      // phone that box is only ~22px to begin with, and the sparklines are
      // the whole point of the tile, so the spacing is kept just wide enough
      // to separate the rows.
      className="aspect-square bg-dashboardCard rounded-2xl p-4 text-left flex flex-col gap-2 transition active:brightness-110 tile-enter"
    >
      {/* Both lines truncate so this block is always exactly two lines tall.
          It's the other shrink-0 sibling of the flex-1 media box, so a
          subtitle that wraps costs the chart its height just as a wrapping
          footer does — that's what kept the Macros sparkline short on a
          narrow phone after the footer was fixed. */}
      <div>
        <p className="text-sm font-semibold text-ink truncate">{title}</p>
        <p className="text-[11px] text-muted mt-0.5 truncate">{subtitle}</p>
      </div>
      {/* overflow-hidden, not just min-h-0 — min-h-0 alone lets this flex
          item shrink below its content's natural height, but without a
          clip, taller-than-expected content (e.g. a text tile whose
          line-clamp still wants more vertical room than a square tile has)
          just paints straight through its own shrunk box and overlaps the
          divider/footer below rather than being cut off cleanly. */}
      {/* Tile media is a visual summary, never a control of its own. Recharts
          3 gives charts a focus/gesture layer by default; without making this
          subtree inert, touching a sparkline briefly focuses just the SVG
          (drawing a box around it) before the parent button navigates. Keep
          one interaction target per tile: this surrounding button. */}
      {/* No py-1 here: it stacked on top of the flex gap for 16px of dead
          space above and below every sparkline, which the fixed-height card
          could only pay for out of the chart itself. The gap alone is the
          separation. Height-agnostic media (HabitStrip, TargetProgressBar)
          self-centers in the extra room; only the charts grow into it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none flex-1 min-h-0 overflow-hidden"
      >
        {children}
      </div>
      {!mediaLayout && <div className="h-px bg-dashboardDivider" />}
      {/* The footer must stay exactly one line. It's a shrink-0 sibling of the
          flex-1 media box, so every line it gains is taken straight out of the
          chart — a two-line footer on a narrow phone collapsed the Steps
          sparkline from 48px to 8px while desktop (wide enough not to wrap)
          looked correct. Keep value+unit short enough to fit rather than
          relying on the ellipsis. */}
      <div className="flex items-center justify-between gap-1">
        <p className="tabular leading-none whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
          <span className="text-lg font-bold text-ink tracking-tight">{value}</span>
          {unit && <span className="text-xs font-normal text-muted ml-1">{unit}</span>}
        </p>
        <ChevronRight size={16} strokeWidth={2.5} className="text-muted shrink-0" />
      </div>
    </button>
  );
}
