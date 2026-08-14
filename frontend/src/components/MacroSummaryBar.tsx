import { useRef, useState } from "react";
import { Flame } from "lucide-react";
import type { Nutrition } from "../api/types";
import { useEnergyUnit, kcalToUnit } from "../lib/energyUnit";
import { useMacroView } from "../lib/macroView";

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
// `letter` is the flame icon's equivalent for the other three macros — same
// P/F/C-suffix convention TimeBlockGroup's own rolled-up totals badge
// already uses, reused here instead of inventing a second one.
const METRICS: { key: "calories" | "protein" | "fat" | "carbs"; label: string; letter: string; color: string }[] = [
  { key: "calories", label: "Calories", letter: "", color: "#749EF4" },
  { key: "protein", label: "Protein", letter: "P", color: "#EF8D6A" },
  { key: "fat", label: "Fat", letter: "F", color: "#F7D372" },
  { key: "carbs", label: "Carbs", letter: "C", color: "#5ABC80" },
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
    // Two layers, not one. overflow-hidden alone (tried first, 2026-08-06)
    // clips this page's own content to its own box — needed because nothing
    // else does: only the scroller (MacroSummaryBar's outer div) clips by
    // default, and that boundary sits far from the seam between this page
    // and its sibling. Confirmed via on-device instrumentation that the
    // seam-peeking bug wasn't a sizing/position bug at all —
    // getBoundingClientRect on every column was byte-identical whether
    // calories remaining showed "1,413" or "14". What differs is how close
    // the Flame icon's stroke sits to the page seam — close enough on this
    // device to visibly cross into the adjacent page. But overflow-hidden
    // on its own only cut that down to a hairline, not zero: at this
    // device's non-integer 3.75 devicePixelRatio, the clip boundary itself
    // is subject to the same sub-device-pixel rounding, so a sliver still
    // escaped even a hard clip sitting exactly at the seam. The inner px-1
    // buffer below gives that rounding error somewhere harmless to land —
    // dead space it clips in this same box, still short of the real seam —
    // instead of needing the clip to be pixel-perfect at the seam itself.
    <div className="w-full shrink-0 overflow-hidden" style={{ scrollSnapAlign: "center" }}>
    {/* grid-cols-4 again (flex-with-natural-widths tried 2026-08-06, reverted
        same day) — natural-width items fixed the text-clipping problem but
        left every bar a different length purely because of digit count (a
        2-digit "29" bar reading as barely-there next to a 4-digit "1,221"
        one), and pushed everything into a left-packed cluster instead of
        spanning the row. Bars need to be a consistent, comparable length
        regardless of value — that's the whole point of a progress bar — so
        equal-width columns are back for the bars specifically. The label
        row above each bar is NOT width-constrained to its column this time
        (no w-full, no truncate) — it's centered on the column but free to
        overflow past it if a value is unusually wide, same as this
        component's original pre-redesign behavior. That overflow is purely
        cosmetic (adjacent labels visually crowding on an extreme day) since
        the actual bug that overflow used to cause — the neighboring swipe
        page's icon bleeding across the seam — is now caught structurally by
        this page's own overflow-hidden + the px-1 buffer below, which don't
        care what the label row itself is doing. */}
    <div className="grid grid-cols-4 gap-3 px-1">
      {METRICS.map((m) => {
        const value = totals[m.key];
        const target = targets ? (m.key === "calories" ? targets.calories : targets[`${m.key}G` as "proteinG" | "fatG" | "carbsG"]) : 0;
        // Whole grams, not tenths — this row now shares space with the
        // icon/letter instead of getting its own line, and the consumed
        // page's "value/target" pairing is already the widest content here.
        // A tenth of a gram isn't meaningfully useful at a glance anyway;
        // more precise figures are still available on the food/day detail
        // screens.
        const decimals = 0;
        const remaining = target - value;
        const over = mode === "remaining" && remaining < 0;
        const barValue = mode === "consumed" ? value : remaining;
        const rawDisplayValue = mode === "consumed" ? value : Math.abs(remaining);
        // pct() is a ratio, so it's unit-invariant — only the displayed
        // numbers below the bar need to convert for calories.
        const displayValue = m.key === "calories" ? kcalToUnit(rawDisplayValue, energyUnit) : rawDisplayValue;
        const displayTarget = m.key === "calories" ? kcalToUnit(target, energyUnit) : target;
        return (
          // MacroFactor-style two rows (icon/letter + number, then the bar)
          // instead of the old three (spelled-out label, bar, number) — the
          // label row is gone visually, kept only for screen readers.
          // Dropping the header from ~3 stacked lines' worth of height to 2
          // was the whole point (see TodayScreen's own header comment on
          // this being the tallest part of a sticky block on a list-first
          // screen); the flame/letter convention isn't new here either — the
          // food log's own per-group totals badge (TimeBlockGroup) already
          // marks calories with the same flame icon and P/F/C suffixes.
          <div key={m.key} className="min-w-0 flex flex-col items-center text-center" aria-label={m.label}>
            {/* No w-full/truncate here — see this function's own top
                comment. The bar below is what needs the equal width; this
                row just centers on it and is allowed to spill over on an
                unusually wide value instead of being hard-clipped. */}
            <p className="tabular flex items-center justify-center gap-1 whitespace-nowrap" aria-hidden="true">
              {m.key === "calories" ? (
                <Flame className="w-3 h-3 shrink-0" strokeWidth={2.4} style={{ color: m.color }} />
              ) : (
                <span className="text-[11px] font-bold shrink-0" style={{ color: m.color }}>
                  {m.letter}
                </span>
              )}
              <span className="text-[11px] font-medium text-white">
                {over ? "+" : ""}
                {fmt(displayValue, decimals)}
              </span>
              {targets && (
                <span className="text-[10px] text-white/60">
                  {mode === "consumed" ? `/${fmt(displayTarget, decimals)}` : over ? "over" : "left"}
                </span>
              )}
            </p>
            <span className="block h-1 w-full rounded-full bg-dashboardTrack overflow-hidden mt-1.5">
              <span
                className="block h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${pct(barValue, target)}%`, backgroundColor: m.color }}
              />
            </span>
          </div>
        );
      })}
    </div>
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
  const { view: defaultView } = useMacroView();
  const firstMode: PageMode = defaultView;
  const secondMode: PageMode = defaultView === "consumed" ? "remaining" : "consumed";
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
        <MacroPage mode={firstMode} totals={totals} targets={targets} energyUnit={energyUnit} />
        <MacroPage mode={secondMode} totals={totals} targets={targets} energyUnit={energyUnit} />
      </div>
      <div className="flex justify-center gap-1.5 mt-1">
        {([0, 1] as const).map((p) => (
          <button
            key={p}
            onClick={() => goTo(p)}
            aria-label={(p === 0 ? firstMode : secondMode) === "remaining" ? "Show remaining" : "Show consumed"}
            className="p-1 -m-1"
          >
            <span
              className={`block h-1.5 rounded-full transition-all duration-300 ${page === p ? "w-4 bg-accent" : "w-1.5 bg-dashboardTrack"}`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
