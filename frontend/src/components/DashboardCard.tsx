import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

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
  children,
}: {
  title: string;
  subtitle: string;
  value: ReactNode;
  unit?: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="aspect-square bg-dashboardCard rounded-2xl p-4 text-left flex flex-col gap-3 transition active:brightness-110"
    >
      <div>
        <p className="text-sm font-semibold text-ink truncate">{title}</p>
        <p className="text-[11px] text-muted mt-0.5">{subtitle}</p>
      </div>
      <div className="flex-1 min-h-0 py-1">{children}</div>
      <div className="h-px bg-dashboardDivider -mx-4" />
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
