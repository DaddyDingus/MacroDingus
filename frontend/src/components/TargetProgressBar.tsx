// A bar whose fill represents today's value, with a fixed vertical tick
// marking the target — positioned 1/6 in from the end (5/6 = 83.3% along the
// track) rather than at the very end, so there's room for the fill to visibly
// pass the tick once today's value goes over target. The bar's own scale
// (barMax) is target * 1.2, which is exactly what puts the target at 5/6: a
// value that lands exactly on target fills the bar exactly up to the tick.
export default function TargetProgressBar({ value, target, color }: { value: number; target: number; color: string }) {
  const barMax = target * 1.2;
  const fillPct = barMax > 0 ? Math.min(100, Math.max(0, (value / barMax) * 100)) : 0;
  const tickPct = (5 / 6) * 100;

  return (
    <div className="relative h-2.5 w-full">
      <div className="absolute inset-0 rounded-full bg-dashboardTrack overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${fillPct}%`, backgroundColor: color }}
        />
      </div>
      {target > 0 && <div className="absolute -top-0.5 -bottom-0.5 w-px bg-ink/60" style={{ left: `${tickPct}%` }} />}
    </div>
  );
}
