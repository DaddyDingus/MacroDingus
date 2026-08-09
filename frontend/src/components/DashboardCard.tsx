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
      className={`aspect-square bg-dashboardCard rounded-2xl p-4 text-left flex flex-col transition active:brightness-110 tile-enter ${mediaLayout ? "gap-2" : "gap-3"}`}
    >
      <div>
        <p className="text-sm font-semibold text-ink truncate">{title}</p>
        <p className="text-[11px] text-muted mt-0.5">{subtitle}</p>
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
      <div
        aria-hidden="true"
        className={`pointer-events-none select-none flex-1 min-h-0 overflow-hidden ${mediaLayout ? "" : "py-1"}`}
      >
        {children}
      </div>
      {!mediaLayout && <div className="h-px bg-dashboardDivider" />}
      <div className="flex items-center justify-between">
        <p className="tabular leading-none">
          <span className="text-lg font-bold text-ink tracking-tight">{value}</span>
          {unit && <span className="text-xs font-normal text-muted ml-1">{unit}</span>}
        </p>
        <ChevronRight size={16} strokeWidth={2.5} className="text-muted shrink-0" />
      </div>
    </button>
  );
}
