import type { ReactNode } from "react";

// A bare stat tile: headline number + optional non-interactive sparkline,
// tapping through to the full interactive chart on a dedicated detail page.
// Per the dataviz stat-tile pattern, the hover/tooltip layer lives on that
// destination page, not duplicated here at sparkline size.
export default function BentoCard({
  label,
  value,
  sub,
  onClick,
  children,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="border border-line bg-surface rounded-md p-4 text-left flex flex-col gap-2 active:bg-surface-raised"
    >
      <div>
        <p className="text-[11px] tracking-widest uppercase text-muted">{label}</p>
        <p className="tabular text-2xl font-medium tracking-tight mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted mt-0.5 truncate">{sub}</p>}
      </div>
      {children && <div className="h-10">{children}</div>}
    </button>
  );
}
