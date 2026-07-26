import {
  LineChart,
  Flame,
  ArrowLeftRight,
  Target,
  CalendarCheck,
  UtensilsCrossed,
  PieChart,
  Beef,
  Wheat,
  Droplet,
  Scale,
  Camera,
  type LucideIcon,
} from "lucide-react";
import type { TileId } from "./dashboardLayout";

// Shared between DashboardCustomizeScreen (reorder view) and AddTilesSheet
// (per-category toggle picker) so a tile's icon can't drift between the two.
export const TILE_ICONS: Record<TileId, LucideIcon> = {
  trendWeight: LineChart,
  expenditure: Flame,
  energyBalance: ArrowLeftRight,
  goalProgress: Target,
  weighInConsistency: CalendarCheck,
  loggingConsistency: UtensilsCrossed,
  macros: PieChart,
  calories: Flame,
  protein: Beef,
  carbs: Wheat,
  fat: Droplet,
  scaleWeight: Scale,
  progressPhotos: Camera,
};
