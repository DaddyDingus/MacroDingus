import { useRef, useState } from "react";
import type { Nutrition } from "../api/types";
import { useEnergyUnit, kcalToUnit } from "../lib/energyUnit";

export interface MacroTargets {
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function pct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, (value / target) * 100));
}

// Same categorical hex values as tailwind.config.js (calories/protein/fat/
// carbs) — kept as raw hex here rather than a Tailwind class since the fill
// color is set via inline style, same pattern DashboardTileSections uses.
const METRICS: { key: "calories" | "protein" | "fat" | "carbs"; label: string; color: string }[] = [
  { key: "calories", label: "Calories", color: "#749EF4" },
  { key: "protein", label: "Protein", color: "#EF8D6A" },
  { key: "fat", label: "Fat", color: "#F7D372" },
  { key: "carbs", label: "Carbs", color: "#5ABC80" },
];

type PageMode = "consumed" | "remaining";

// One page of the swipeable bar. In "remaining" mode both the bar fill and
// the headline number flip to target-minus-consumed (same semantics as
// DashboardTotalsArcCard's remaining mode) — the bar drains toward empty as
// the day fills up, rather than filling like the consumed page does.
function MacroPage({
  mode,
  totals,
  targets,
  energyUnit,
}: {
  mode: PageMode;
  totals: Nutrition;
  targets: MacroTargets | null;
  energyUnit: "kcal" | "kj";
}) {
  return (
    <div className="grid grid-cols-4 gap-3 w-full shrink-0" style={{ scrollSnapAlign: "center" }}>
      {METRICS.map((m) => {
        const value = totals[m.key];
        const target = targets ? (m.key === "calories" ? targets.calories : targets[`${m.key}G` as "proteinG" | "fatG" | "carbsG"]) : 0;
        const decimals = m.key === "calories" ? 0 : 1;
        const remaining = target - value;
        const over = mode === "remaining" && remaining < 0;
        const barValue = mode === "consumed" ? value : remaining;
        const rawDisplayValue = mode === "consumed" ? value : Math.abs(remaining);
        // pct() is a ratio, so it's unit-invariant — only the displayed
        // numbers below the bar need to convert for calories.
        const displayValue = m.key === "calories" ? kcalToUnit(rawDisplayValue, energyUnit) : rawDisplayValue;
        const displayTarget = m.key === "calories" ? kcalToUnit(target, energyUnit) : target;
        return (
          <div key={m.key} className="min-w-0 flex flex-col items-center text-center">
            <p className="text-[11px] tracking-widest uppercase text-muted truncate">{m.label}</p>
            <span className="block h-1 w-full rounded-full bg-dashboardTrack overflow-hidden mt-1.5">
              <span
                className="block h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${pct(barValue, target)}%`, backgroundColor: m.color }}
              />
            </span>
            <p className="tabular mt-1 truncate">
              <span className="text-[11px] font-medium text-white">
                {over ? "+" : ""}
                {fmt(displayValue, decimals)}
              </span>
              {targets && (
                <span className="text-[9px] text-muted">
                  {mode === "consumed" ? `/${fmt(displayTarget, decimals)}` : over ? " over" : " left"}
                </span>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// Deliberately not built on TargetProgressBar — that component's target tick
// is the wrong look here. Track thickness (h-1) mirrors
// DashboardTotalsArcCard's own macro row exactly, no tick, fully rounded
// ends — that's the "Daily Nutrition" card at the top of the Dashboard, the
// thing a user actually visually compares this against (confirmed by pixel-
// measuring two rounds of user screenshots against it — h-2.5 and h-1.5 both
// measured objectively thicker, not just "felt" thicker). Don't bump this to
// match the Dashboard's separate per-macro tiles (TargetProgressBar, h-2.5)
// — that's a different card entirely and was tried once already.
//
// Two swipeable pages (Consumed / Remaining), same technique
// DashboardTotalsArcCard's own Total/Remaining pages now use — this sits in
// TodayScreen's sticky header where a persistent toggle control would compete with the day-nav
// row above it, so paging is just a horizontal swipe with dot indicators.
// Built on native CSS scroll-snap (same technique as TimeWheelPicker.tsx)
// rather than hand-rolled pointer-drag math — momentum/rubber-band and the
// "smooth" glide between pages come from the browser for free.
export default function MacroSummaryBar({ totals, targets }: { totals: Nutrition; targets: MacroTargets | null }) {
  const { unit: energyUnit } = useEnergyUnit();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<0 | 1>(0);

  if (!targets) {
    return <MacroPage mode="consumed" totals={totals} targets={null} energyUnit={energyUnit} />;
  }

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

  return (
    <div>
      {/* touch-action: pan-x — this scroller sits inside TodayScreen's
          vertically-scrolling page, so without an explicit axis hint the
          browser has to wait and guess which ancestor "owns" a gesture that
          isn't purely horizontal, which read as the swipe barely working.
          Declaring pan-x here means a touch that starts on this element is
          committed to horizontal panning immediately; any vertical component
          falls through to the page underneath instead of being contested.

          py-2 — the label/bar/value stack is only ~40px tall on its own, so
          a swipe that started a few px above the label or below the value
          text used to land outside this div entirely and fall through to
          the page scroll instead of being picked up here. Real padding
          rather than the padding+negative-margin trick the dot buttons
          below use (p-1 -m-1) — a negative bottom margin here would collapse
          against the dot row's own top margin, pulling it up into this
          div's padding and creating an ambiguous overlap between two
          separately-handled touch targets right at their shared border.

          data-no-rubber-band — the actual cause of the swipe being hit-or-
          miss. This sits at the very top of TodayScreen (scrollY 0), and
          useRubberBandScroll's window-level touchmove listener arms a
          pull-to-refresh stretch on *any* touch with downward vertical
          wobble while scrollY <= 0 — a real finger swipe is never perfectly
          horizontal, so it kept winning the race and preventDefault()-ing
          the gesture out from under the scroll-snap. Same escape hatch
          PhotoCompareScreen's before/after slider already needed for the
          same reason (see that hook's own comment on this attribute). */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        data-no-rubber-band
        className="flex overflow-x-auto no-scrollbar overscroll-x-contain py-2 select-none"
        style={{ scrollSnapType: "x mandatory", touchAction: "pan-x" }}
      >
        <MacroPage mode="remaining" totals={totals} targets={targets} energyUnit={energyUnit} />
        <MacroPage mode="consumed" totals={totals} targets={targets} energyUnit={energyUnit} />
      </div>
      <div className="flex justify-center gap-1.5 mt-2">
        {([0, 1] as const).map((p) => (
          <button key={p} onClick={() => goTo(p)} aria-label={p === 0 ? "Show remaining" : "Show consumed"} className="p-1 -m-1">
            <span
              className={`block h-1.5 rounded-full transition-all duration-300 ${page === p ? "w-4 bg-accent" : "w-1.5 bg-dashboardTrack"}`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
