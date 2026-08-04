import { useEffect, useRef, useState } from "react";
import { useEnergyUnit, kcalToUnit, energyUnitLabel } from "../lib/energyUnit";

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
const CENTER_X = 60;
// The drawn arc leaves its bottom quarter open, so its actual vertical
// extent isn't a full circle — top edge is RADIUS+STROKE_WIDTH/2 above
// center, but the bottom is only as low as the two open-ended endpoints
// (135°/225°), which sit well short of a full circle's bottom. Centering the
// circle at the viewBox's literal midpoint (60) therefore leaves the drawn
// ring sitting noticeably higher than visual-center, with a lot of empty
// space below it and very little above.
//
// This used to be "fixed" by giving the ring's wrapper div a `-mt-[14px]`
// instead — pulling the *box* up to fake a centered ring. That doesn't
// actually recenter the ring; it just pushes the box (and the ring drawn
// inside it) upward past its own row's top edge, since the row's height is
// set by this box in the first place (items-center gives a same-height item
// zero slack to shift into). The horizontal scroller this card's pages sit
// in has `overflow-x-auto`, which per the CSS overflow spec forces
// overflow-y to compute to `auto` too (only one axis can stay `visible`) —
// so that overshoot was silently clipped at the scroller's own top edge
// instead of just spilling harmlessly into the card's padding, cutting the
// top of the ring off. Baking the offset into the circle's own center (here)
// instead means the drawn geometry is already balanced within its viewBox,
// so the box never needs to move (and can't overshoot its row).
const CENTER_Y = 67;
// Box is w-36/h-36 (144px) wrapping a 0-120 viewBox — 1.2px per svg unit.
// The center text overlay is a separate absolutely-positioned div, not part
// of the SVG, so it doesn't automatically follow CENTER_Y's shift; it needs
// this same offset (in real px) applied to stay lined up with the ring's new
// visual center instead of the box's plain geometric one.
const VIEWBOX_TO_BOX_PX = 144 / 120;
const CENTER_TEXT_OFFSET_PX = (CENTER_Y - CENTER_X) * VIEWBOX_TO_BOX_PX;

// Horseshoe gauge: a 270° arc starting at bottom-left, sweeping clockwise
// over the top to bottom-right, leaving the bottom quarter open. Angles are
// measured clockwise from the top (0 = 12 o'clock), so plain trig gives the
// arc endpoints directly without needing a viewBox rotation trick.
const GAUGE_START = 225;
const GAUGE_SWEEP = 270;

function polarToCartesian(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER_X + RADIUS * Math.sin(rad), y: CENTER_Y - RADIUS * Math.cos(rad) };
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

type ArcMode = "total" | "remaining";

// One page of the swipeable card — same total/remaining semantics
// MacroSummaryBar's own "consumed"/"remaining" pages use.
function ArcPage({
  mode,
  active,
  totals,
  targets,
  energyUnit,
}: {
  mode: ArcMode;
  active: boolean;
  totals: DashboardTotals;
  targets: DashboardTotals | null;
  energyUnit: "kcal" | "kj";
}) {
  const [ringRevealed, setRingRevealed] = useState(false);
  const remaining = targets ? targets.calories - totals.calories : null;
  const ringValue = mode === "remaining" && remaining !== null ? remaining : totals.calories;
  const ringPct = targets ? pct(ringValue, targets.calories) : 0;

  // Both swipe pages stay mounted side-by-side, so a mount-only CSS
  // animation would run once while one page is still off-screen and never
  // replay. Reset an inactive page without a transition, then reveal it on
  // the next frame when the swipe crosses the midpoint and makes it active.
  useEffect(() => {
    if (!active) {
      setRingRevealed(false);
      return;
    }
    setRingRevealed(false);
    const frame = requestAnimationFrame(() => setRingRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, [active]);

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
    <div className="w-full shrink-0 space-y-5" style={{ scrollSnapAlign: "center" }}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="flex flex-col items-center justify-center text-center gap-0.5">
          <span className="text-[11px] tracking-widest uppercase text-muted">{leftLabel}</span>
          <span className="tabular text-xl font-medium tracking-tight">
            {leftValue === null ? "–" : fmt(kcalToUnit(Math.abs(leftValue), energyUnit))}
          </span>
        </div>

        {/* No negative margin here — the ring is pre-centered within the SVG's
            own viewBox via CENTER_Y above, so this box can just sit at its
            natural position. See CENTER_Y's comment for why a margin-based
            pull-up was clipped by the horizontal scroller this sits in. */}
        <div className="relative w-36 h-36 mx-auto flex items-center justify-center">
          <svg viewBox="0 0 120 120" className="w-full h-full">
            <path d={TRACK_PATH} strokeWidth={STROKE_WIDTH} strokeLinecap="round" className="fill-none stroke-dashboardTrack" />
            <path
              d={TRACK_PATH}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeDasharray={ARC_LENGTH}
              strokeDashoffset={ringRevealed ? ARC_LENGTH * (1 - ringPct / 100) : ARC_LENGTH}
              className={`fill-none text-calories motion-reduce:transition-none ${
                active ? "transition-[stroke-dashoffset] duration-500 ease-out" : ""
              }`}
              stroke="currentColor"
            />
          </svg>
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
            style={{ transform: `translateY(${CENTER_TEXT_OFFSET_PX}px)` }}
          >
            <span className="tabular text-3xl font-semibold tracking-tight leading-none">
              {fmt(kcalToUnit(centerValue, energyUnit))}
            </span>
            <span className="text-[10px] tracking-widest uppercase text-muted leading-none mt-1">{centerLabel}</span>
            <span className="text-[10px] text-muted leading-none">{energyUnitLabel(energyUnit)}</span>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center text-center gap-0.5">
          <span className="text-[11px] tracking-widest uppercase text-muted">Target</span>
          <span className="tabular text-xl font-medium tracking-tight">
            {targets ? fmt(kcalToUnit(targets.calories, energyUnit)) : "–"}
          </span>
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
    </div>
  );
}

// Two swipeable pages (Total / Remaining) rather than the tap toggle this
// used to have — same reasoning and same native-scroll-snap technique as
// MacroSummaryBar.tsx's own Consumed/Remaining pages, so the Home Dashboard
// and Food Log headers page the same way. Paging state lives entirely in
// here now (previously lifted to DashboardScreen as mode/onModeChange, back
// when ModeToggle needed it there) since nothing else on the screen reads it.
export default function DashboardTotalsArcCard({
  totals,
  targets,
}: {
  totals: DashboardTotals;
  targets: DashboardTotals | null;
}) {
  const { unit: energyUnit } = useEnergyUnit();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<0 | 1>(0);

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    setPage(el.scrollLeft > el.clientWidth / 2 ? 1 : 0);
  }

  function goTo(p: 0 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: p * el.clientWidth, behavior: "smooth" });
  }

  if (!targets) {
    return (
      <div className="bg-dashboardCard rounded-2xl overflow-hidden">
        <div className="px-5 py-5">
          <ArcPage mode="total" active totals={totals} targets={null} energyUnit={energyUnit} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-dashboardCard rounded-2xl overflow-hidden">
      <div className="px-5 py-5">
        {/* Same escape hatch MacroSummaryBar's scroller needs (see that
            file's own comment): this card sits at the very top of the
            Dashboard (scrollY 0), where useRubberBandScroll's pull-to-refresh
            listener otherwise wins the race against a real horizontal swipe. */}
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          data-no-rubber-band
          className="flex overflow-x-auto no-scrollbar overscroll-x-contain select-none"
          style={{ scrollSnapType: "x mandatory", touchAction: "pan-x" }}
        >
          <ArcPage mode="total" active={page === 0} totals={totals} targets={targets} energyUnit={energyUnit} />
          <ArcPage mode="remaining" active={page === 1} totals={totals} targets={targets} energyUnit={energyUnit} />
        </div>
        <div className="flex justify-center gap-1.5 mt-4">
          {([0, 1] as const).map((p) => (
            <button key={p} onClick={() => goTo(p)} aria-label={p === 0 ? "Show total" : "Show remaining"} className="p-1 -m-1">
              <span
                className={`block h-1.5 rounded-full transition-all duration-300 ${page === p ? "w-4 bg-accent" : "w-1.5 bg-dashboardTrack"}`}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
