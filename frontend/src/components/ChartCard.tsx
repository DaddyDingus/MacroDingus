import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import RangeToggle, { type RangePreset } from "./RangeToggle";
import type { ChartGesture } from "../hooks/useChartGesture";

// The shared card every history chart in the app renders into — border,
// height-transitioning gesture-driven chart area, then a RangeToggle row
// below the chart with the expand/collapse chevron pinned to its end (next
// to "All"), and an optional centered legend row below that. Modeled
// directly on the Expenditure screen's original bespoke layout
// (ExpenditureChartCard) so every chart reads as one consistent system
// instead of each screen inventing its own arrangement. The chevron used to
// sit in its own row above the chart — moved down here so the chart itself
// gets that vertical space back.
export default function ChartCard({
  gesture,
  presets,
  legend,
  children,
}: {
  gesture: ChartGesture;
  presets: RangePreset[];
  legend?: ReactNode;
  children: (windowStart: number, windowEnd: number, height: number) => ReactNode;
}) {
  return (
    <div className="border border-line bg-surface rounded-2xl py-4">
      {/* No horizontal padding here, deliberately — this is the one part of
          the card that's actual data, not UI chrome, and MacroFactor's own
          charts read as roomier largely because they run edge-to-edge
          instead of inset like a normal card. Keeping the card's border
          (unlike MacroFactor, which has no card at all) preserves this
          screen's visual consistency with every other bordered section,
          while letting just the plot area claim the width a border+padding
          combo would otherwise eat into. CHART_MARGIN's own left:-12/right:8
          (chartLayout.ts) already manages the small edge clearance Recharts
          itself needs — this div must stay unpadded so the gesture overlay
          (absolutely positioned, measured from this div's padding edge,
          which padding here would NOT shift since it's an in-flow sibling
          calculation) stays pixel-aligned with the chart it's captured over. */}
      <div className="relative transition-[height] duration-300 ease-out" style={{ height: gesture.chartHeight }}>
        {children(gesture.view.start, gesture.view.end, gesture.chartHeight)}
        {gesture.overlay}
      </div>
      <div className="mt-3 px-4 flex items-center justify-between gap-2">
        <RangeToggle presets={presets} value={gesture.activeDays} onChange={gesture.selectPreset} />
        <button
          type="button"
          onClick={gesture.toggleExpanded}
          aria-label={gesture.expanded ? "Collapse chart" : "Expand chart"}
          className="flex items-center justify-center w-7 h-7 rounded-full border border-line text-muted shrink-0"
        >
          <ChevronDown
            className="w-4 h-4 transition-transform duration-300"
            style={{ transform: gesture.expanded ? "rotate(180deg)" : "none" }}
          />
        </button>
      </div>
      {legend && <div className="flex items-center justify-center gap-2 px-4 pt-3">{legend}</div>}
    </div>
  );
}
