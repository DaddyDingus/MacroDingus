import type { CSSProperties } from "react";

// Feeds the .tile-enter keyframe animation (index.css) via the --tile-delay
// custom property it reads its animation-delay from. Shared by the Dashboard
// tile grid (many small tiles, short step) and every detail screen's
// top-level block cascade (few larger cards, longer step) so both stay
// tuned from one place instead of drifting apart.
export function staggerStyle(index: number, stepMs = 30, maxIndex = 10): CSSProperties {
  return { "--tile-delay": `${Math.min(index, maxIndex) * stepMs}ms` } as CSSProperties;
}
