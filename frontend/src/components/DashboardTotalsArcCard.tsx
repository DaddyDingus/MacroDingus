import ModeToggle from "./ModeToggle";

export interface DashboardTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function pct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, (value / target) * 100));
}

const RADIUS = 48;
const STROKE_WIDTH = 5;
const CENTER = 60;

// Horseshoe gauge: a 270° arc starting at bottom-left, sweeping clockwise
// over the top to bottom-right, leaving the bottom quarter open. Angles are
// measured clockwise from the top (0 = 12 o'clock), so plain trig gives the
// arc endpoints directly without needing a viewBox rotation trick.
const GAUGE_START = 225;
const GAUGE_SWEEP = 270;

function polarToCartesian(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + RADIUS * Math.sin(rad), y: CENTER - RADIUS * Math.cos(rad) };
}

function describeArc(startAngle: number, sweepAngle: number): string {
  if (sweepAngle <= 0) return "";
  const start = polarToCartesian(startAngle);
  const end = polarToCartesian(startAngle + sweepAngle);
  const largeArcFlag = sweepAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

const TRACK_PATH = describeArc(GAUGE_START, GAUGE_SWEEP);
// Exact for a circular arc: length = radius * angle (radians). Used to drive
// the progress reveal via stroke-dasharray/dashoffset instead of regenerating
// the path's `d` on every render — animating `d` snaps oddly whenever the
// sweep crosses 180° and the large-arc-flag flips, so the dashoffset is the
// only part that needs to transition.
const ARC_LENGTH = RADIUS * ((GAUGE_SWEEP * Math.PI) / 180);

const MACRO_COLUMNS: Array<{ key: "protein" | "fat" | "carbs"; label: string; colorClass: string }> = [
  { key: "protein", label: "Protein", colorClass: "bg-protein" },
  { key: "fat", label: "Fat", colorClass: "bg-fat" },
  { key: "carbs", label: "Carbs", colorClass: "bg-carbs" },
];

export default function DashboardTotalsArcCard({
  totals,
  targets,
  mode,
  onModeChange,
}: {
  totals: DashboardTotals;
  targets: DashboardTotals | null;
  mode: "total" | "remaining";
  onModeChange: (mode: "total" | "remaining") => void;
}) {
  const remaining = targets ? targets.calories - totals.calories : null;
  const ringValue = mode === "remaining" && remaining !== null ? remaining : totals.calories;
  const ringPct = targets ? pct(ringValue, targets.calories) : 0;

  const centerLabel = mode === "total" ? "Consumed" : remaining !== null && remaining < 0 ? "Over" : "Remaining";
  const centerValue = mode === "total" ? totals.calories : remaining !== null ? Math.abs(remaining) : totals.calories;

  const leftLabel = mode === "total" ? "Remaining" : "Consumed";
  const leftValue = mode === "total" ? remaining : totals.calories;

  const macroData = MACRO_COLUMNS.map((m) => {
    const consumed = totals[m.key];
    const target = targets?.[m.key];
    const remainingValue = target !== undefined ? target - consumed : null;
    const displayValue = mode === "remaining" && remainingValue !== null ? remainingValue : consumed;
    return { ...m, displayValue, target };
  });

  return (
    <div className="bg-dashboardCard rounded-2xl overflow-hidden">
      <div className="px-5 py-5 space-y-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
          <div className="flex flex-col items-center justify-center text-center gap-0.5">
            <span className="text-[11px] tracking-widest uppercase text-muted">{leftLabel}</span>
            <span className="tabular text-xl font-medium tracking-tight">
              {leftValue === null ? "–" : fmt(Math.abs(leftValue))}
            </span>
          </div>

          {/* The horseshoe arc leaves its bottom quarter open, so the visible ring
              sits ~14px below this box's own top edge but flush with its bottom —
              pull it up so the ring itself (not its invisible bounding box) is what
              lines up symmetrically with the card's top/bottom padding. */}
          <div className="relative w-36 h-36 mx-auto flex items-center justify-center -mt-[14px]">
            <svg viewBox="0 0 120 120" className="w-full h-full">
              <path d={TRACK_PATH} strokeWidth={STROKE_WIDTH} strokeLinecap="round" className="fill-none stroke-dashboardTrack" />
              <path
                d={TRACK_PATH}
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeDasharray={ARC_LENGTH}
                strokeDashoffset={ARC_LENGTH * (1 - ringPct / 100)}
                className="fill-none text-calories transition-[stroke-dashoffset] duration-500 ease-out"
                stroke="currentColor"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
              <span className="tabular text-3xl font-semibold tracking-tight leading-none">{fmt(centerValue)}</span>
              <span className="text-[10px] tracking-widest uppercase text-muted leading-none mt-1">{centerLabel}</span>
              <span className="text-[10px] text-muted leading-none">kcal</span>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center text-center gap-0.5">
            <span className="text-[11px] tracking-widest uppercase text-muted">Target</span>
            <span className="tabular text-xl font-medium tracking-tight">{targets ? fmt(targets.calories) : "–"}</span>
          </div>
        </div>

        <div>
          <div className="grid grid-cols-3 gap-4">
            {macroData.map((m) => (
              <span key={`${m.key}-label`} className="text-[11px] tracking-widest uppercase text-muted text-center">
                {m.label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4 mt-2">
            {macroData.map((m) => (
              <span key={`${m.key}-track`} className="block h-1 w-full rounded-full bg-dashboardTrack overflow-hidden">
                <span
                  className={`block h-full rounded-full ${m.colorClass} transition-[width] duration-500 ease-out`}
                  style={{ width: `${m.target !== undefined ? pct(m.displayValue, m.target) : 0}%` }}
                />
              </span>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4 mt-1.5">
            {macroData.map((m) => (
              <span key={`${m.key}-value`} className="tabular text-[10px] text-center whitespace-nowrap">
                <span className="text-ink font-semibold">{fmt(m.displayValue, 1)}</span>
                {m.target !== undefined ? (
                  <span className="text-muted font-normal"> / {fmt(m.target, 1)}g</span>
                ) : (
                  <span className="text-ink font-semibold">g</span>
                )}
              </span>
            ))}
          </div>
        </div>

        {targets && (
          <div className="flex justify-center">
            <ModeToggle mode={mode} onModeChange={onModeChange} />
          </div>
        )}
      </div>
    </div>
  );
}
