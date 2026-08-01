import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { ChangeDirection } from "../lib/changeIndicator";

// colorClassName only applies to increase/decrease — "none" always renders
// muted, since a flat reading isn't the series' color, it's an absence of
// change.
export default function ChangeDirectionIcon({
  direction,
  colorClassName = "text-muted",
}: {
  direction: ChangeDirection;
  colorClassName?: string;
}) {
  const cls = `w-3.5 h-3.5 ${direction === "none" ? "text-muted" : colorClassName}`;
  if (direction === "increase") return <TrendingUp className={cls} strokeWidth={2} />;
  if (direction === "decrease") return <TrendingDown className={cls} strokeWidth={2} />;
  return <Minus className={cls} strokeWidth={2} />;
}
