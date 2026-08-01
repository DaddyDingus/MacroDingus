import { dateFromDayIndex } from "./date";
import type { RangePreset } from "../components/RangeToggle";

// Shared by every history chart (TdeeChart, WeightChart, ScaleWeightChart,
// EnergyBalanceChart, MacroHistoryChart, NutrientHistoryChart) so the
// gesture overlay in useChartGesture can line up with the plotted area
// without measuring Recharts' rendered DOM — a single source of truth beats
// every chart re-declaring the same margin/width and risking drift.
// left/right were tuned for a container that had 16px of its own padding
// (the old p-4 card) cushioning them — ChartCard's plot area now sits flush
// against the card's own border (see its own comment for why), so these
// need their own clearance instead of borrowing the container's. Too little
// and the Y-axis numbers crowd the left edge / collide with the card's
// rounded corner, and the trailing X-axis date label runs into the right
// edge — both need to be non-negative enough to clear rounded-2xl's corner
// curve near the top of the card, not just avoid literal clipping.
export const CHART_MARGIN = { top: 8, right: 14, left: -4, bottom: 0 };
export const Y_AXIS_WIDTH = 40;
export const CHART_HEIGHT = 220;
// A fixed taller height for the expand toggle, not a freely-resizable panel —
// most of the benefit is on the denser 1M+ views where a lot of days get
// compressed into 220px; 1W already has plenty of room.
export const CHART_HEIGHT_EXPANDED = 380;

export const GRID = "rgb(var(--color-divider))";
export const MUTED = "#8A8F98";

export const RANGE_PRESETS: RangePreset[] = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "All", days: 3650 },
];

export function formatShortTs(ts: number): string {
  const [, m, d] = dateFromDayIndex(ts).split("-").map(Number);
  return new Date(2000, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// MacroFactor only draws per-point dots on a line at 1W/1M zoom — past that,
// daily points are packed too tightly and the dots read as noise, so the
// line runs bare. 30 days matches the "1M" preset exactly; any chart with a
// dot-per-actual-point Line (as opposed to a dot-per-bucket or
// sparse-by-nature series like TdeeChart's check-in dots) should gate its
// `dot` prop through this rather than deciding its own threshold.
export function showPointDots(windowDays: number): boolean {
  return windowDays <= 30;
}
