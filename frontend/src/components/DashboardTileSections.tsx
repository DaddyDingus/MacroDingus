import { useNavigate } from "react-router-dom";
import { useLogsHistory, useLoggedDates } from "../api/logs";
import { useCoachStatus, useCheckinHistory } from "../api/coach";
import { useWeightTrend, useWeights } from "../api/weights";
import { kgToUnit, useWeightUnit } from "../lib/weightUnit";
import { activeCheckinForDate } from "../lib/checkins";
import { computeGoalProgressPercent } from "../lib/goalProgress";
import { addDays, localDateString } from "../lib/date";
import { CATEGORIES, useDashboardLayout, type TileId } from "../lib/dashboardLayout";
import BentoCard from "./BentoCard";
import MiniLineSpark from "./MiniLineSpark";
import MiniBarSpark from "./MiniBarSpark";
import HabitStrip from "./HabitStrip";

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function countRecentActive(activeDates: Set<string>, days: number): number {
  const today = localDateString();
  let count = 0;
  for (let i = 0; i < days; i++) {
    if (activeDates.has(addDays(today, -i))) count++;
  }
  return count;
}

const NUTRIENT_LABELS: Record<"calories" | "protein" | "carbs" | "fat", string> = {
  calories: "Calories",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
};

// Split out from DashboardScreen and loaded via React.lazy purely for bundle
// size — this is the only part of the dashboard that touches recharts
// (~420kB), which must not land in the eager landing-page bundle. Same
// reasoning as the barcode scanner and the old Trends screen.
export default function DashboardTileSections() {
  const navigate = useNavigate();
  const { unit } = useWeightUnit();
  const { layout } = useDashboardLayout();

  const weightTrend = useWeightTrend(30);
  const weighIns = useWeights(30);
  const coachStatus = useCoachStatus();
  const checkinHistory = useCheckinHistory();
  const history7 = useLogsHistory(7);
  const loggedDates = useLoggedDates();

  const checkin = coachStatus.data?.latestCheckin ?? null;
  const trendWeightKg = coachStatus.data?.trendWeightKg ?? null;
  const profile = coachStatus.data?.profile ?? null;

  const trendPoints = weightTrend.data ?? [];
  const latestTrend = trendPoints[trendPoints.length - 1];
  const trendSparkValues = trendPoints.map((p) => kgToUnit(p.trendKg, unit));

  const weighInList = weighIns.data ?? [];
  const latestScale = weighInList[weighInList.length - 1];
  const scaleSparkValues = weighInList.map((w) => kgToUnit(w.weightKg, unit));
  const weighInDates = new Set(weighInList.map((w) => w.date));

  const checkinsAsc = [...(checkinHistory.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const tdeeSparkValues = checkinsAsc.map((c) => c.tdee);

  const history = history7.data ?? [];

  const balanceDays = history
    .map((d) => ({ calories: d.calories, tdee: activeCheckinForDate(checkinsAsc, d.date)?.tdee ?? null }))
    .filter((d): d is { calories: number; tdee: number } => d.tdee !== null);
  const balanceSparkValues = balanceDays.map((d) => d.calories - d.tdee);
  const latestBalance = balanceSparkValues.length > 0 ? balanceSparkValues[balanceSparkValues.length - 1] : null;

  const avgCalories = history.length > 0 ? history.reduce((s, d) => s + d.calories, 0) / history.length : 0;
  const macroSparkPoints = history.map((d) => ({
    proteinKcal: Math.round(d.protein * 4),
    carbsKcal: Math.round(d.carbs * 4),
    fatKcal: Math.round(d.fat * 9),
  }));

  const loggedDateSet = new Set(loggedDates.data?.dates ?? []);

  function renderTile(id: TileId) {
    switch (id) {
      case "trendWeight":
        return (
          <BentoCard
            key={id}
            label="Trend weight"
            value={latestTrend ? `${kgToUnit(latestTrend.trendKg, unit).toFixed(1)} ${unit}` : "—"}
            sub="EWMA trend"
            onClick={() => navigate("/weight")}
          >
            <MiniLineSpark values={trendSparkValues} />
          </BentoCard>
        );

      case "expenditure":
        return (
          <BentoCard
            key={id}
            label="Expenditure"
            value={checkin ? fmt(checkin.tdee) : "—"}
            sub={checkin ? "kcal TDEE" : "No check-in yet"}
            onClick={() => navigate("/expenditure")}
          >
            <MiniLineSpark values={tdeeSparkValues} />
          </BentoCard>
        );

      case "energyBalance":
        return (
          <BentoCard
            key={id}
            label="Energy balance"
            value={latestBalance !== null ? `${latestBalance >= 0 ? "+" : ""}${fmt(latestBalance)}` : "—"}
            sub={latestBalance !== null ? "kcal balance" : "Check in to see this"}
            onClick={() => navigate("/energy-balance")}
          >
            <MiniLineSpark values={balanceSparkValues} />
          </BentoCard>
        );

      case "goalProgress": {
        const goalWeightKg = profile?.goalWeightKg ?? null;
        const goalStartWeightKg = profile?.goalStartWeightKg ?? null;
        const percent =
          goalWeightKg != null && goalStartWeightKg != null && trendWeightKg != null
            ? computeGoalProgressPercent(goalStartWeightKg, goalWeightKg, trendWeightKg)
            : null;
        return (
          <BentoCard
            key={id}
            label="Goal progress"
            value={percent !== null ? `${percent.toFixed(0)}%` : "—"}
            sub={percent !== null ? "to goal" : goalWeightKg ? "Log a weight" : "Set a goal"}
            onClick={() => navigate("/goal-progress")}
          />
        );
      }

      case "weighInConsistency":
        return (
          <BentoCard
            key={id}
            label="Weigh-ins"
            value={`${countRecentActive(weighInDates, 30)}/30`}
            sub="last 30 days"
            onClick={() => navigate("/habits/weigh-ins")}
          >
            <HabitStrip activeDates={weighInDates} />
          </BentoCard>
        );

      case "loggingConsistency":
        return (
          <BentoCard
            key={id}
            label="Food logging"
            value={`${countRecentActive(loggedDateSet, 30)}/30`}
            sub="last 30 days"
            onClick={() => navigate("/habits/logging")}
          >
            <HabitStrip activeDates={loggedDateSet} />
          </BentoCard>
        );

      case "macros":
        return (
          <BentoCard
            key={id}
            label="Macros"
            value={history.length > 0 ? fmt(avgCalories) : "—"}
            sub={history.length > 0 ? "avg kcal/day, 7d" : "No logs yet"}
            onClick={() => navigate("/macros")}
          >
            <MiniBarSpark points={macroSparkPoints} />
          </BentoCard>
        );

      case "calories":
      case "protein":
      case "carbs":
      case "fat": {
        const values = history.map((d) => d[id]);
        const avg = history.length > 0 ? values.reduce((s, v) => s + v, 0) / history.length : 0;
        const unitLabel = id === "calories" ? "kcal" : "g";
        return (
          <BentoCard
            key={id}
            label={NUTRIENT_LABELS[id]}
            value={history.length > 0 ? fmt(avg, id === "calories" ? 0 : 1) : "—"}
            sub={history.length > 0 ? `avg ${unitLabel}/day, 7d` : "No logs yet"}
            onClick={() => navigate(`/nutrition/${id}`)}
          >
            <MiniLineSpark values={values} />
          </BentoCard>
        );
      }

      case "scaleWeight":
        return (
          <BentoCard
            key={id}
            label="Scale weight"
            value={latestScale ? `${kgToUnit(latestScale.weightKg, unit).toFixed(1)} ${unit}` : "—"}
            sub="Last weigh-in"
            onClick={() => navigate("/weight")}
          >
            <MiniLineSpark values={scaleSparkValues} />
          </BentoCard>
        );
    }
  }

  return (
    <>
      {CATEGORIES.map((cat) => {
        const tileIds = layout[cat.id];
        if (tileIds.length === 0) return null;
        return (
          <section key={cat.id}>
            <p className="text-[11px] tracking-widest uppercase text-muted mb-2 px-1">{cat.label}</p>
            <div className="grid grid-cols-2 gap-3">{tileIds.map((id) => renderTile(id))}</div>
          </section>
        );
      })}
    </>
  );
}
