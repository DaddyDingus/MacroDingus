import { useNavigate } from "react-router-dom";
import { useLogsHistory } from "../api/logs";
import { useCoachStatus, useCheckinHistory } from "../api/coach";
import { useWeightTrend, useWeights } from "../api/weights";
import { kgToUnit, useWeightUnit } from "../lib/weightUnit";
import BentoCard from "./BentoCard";
import MiniLineSpark from "./MiniLineSpark";
import MiniBarSpark from "./MiniBarSpark";

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

// Split out from DashboardScreen and loaded via React.lazy purely for bundle
// size — this is the only part of the dashboard that touches recharts
// (~420kB), which must not land in the eager landing-page bundle. Same
// reasoning as the barcode scanner and the old Trends screen.
export default function DashboardInsights() {
  const navigate = useNavigate();
  const { unit } = useWeightUnit();
  const weightTrend = useWeightTrend(30);
  const recentWeighIns = useWeights(30);
  const coachStatus = useCoachStatus();
  const checkinHistory = useCheckinHistory();
  const macroHistory = useLogsHistory(14);

  const checkin = coachStatus.data?.latestCheckin;

  const trendPoints = weightTrend.data ?? [];
  const latestTrend = trendPoints[trendPoints.length - 1];
  const trendSparkValues = trendPoints.map((p) => kgToUnit(p.trendKg, unit));

  const weighIns = recentWeighIns.data ?? [];
  const latestScale = weighIns[weighIns.length - 1];
  const scaleSparkValues = weighIns.map((w) => kgToUnit(w.weightKg, unit));

  const checkinsAsc = [...(checkinHistory.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const tdeeSparkValues = checkinsAsc.map((c) => c.tdee);

  const history = macroHistory.data ?? [];
  const last7 = history.slice(-7);
  const avgCalories = last7.length > 0 ? last7.reduce((s, d) => s + d.calories, 0) / last7.length : 0;
  const macroSparkPoints = history.map((d) => ({
    proteinKcal: Math.round(d.protein * 4),
    carbsKcal: Math.round(d.carbs * 4),
    fatKcal: Math.round(d.fat * 9),
  }));

  return (
    <section>
      <p className="text-[11px] tracking-widest uppercase text-muted mb-2 px-1">Insights &amp; analytics</p>
      <div className="grid grid-cols-2 gap-3">
        <BentoCard
          label="Trend weight"
          value={latestTrend ? `${kgToUnit(latestTrend.trendKg, unit).toFixed(1)} ${unit}` : "—"}
          sub="EWMA trend"
          onClick={() => navigate("/weight")}
        >
          <MiniLineSpark values={trendSparkValues} />
        </BentoCard>

        <BentoCard
          label="Scale weight"
          value={latestScale ? `${kgToUnit(latestScale.weightKg, unit).toFixed(1)} ${unit}` : "—"}
          sub="Last weigh-in"
          onClick={() => navigate("/weight")}
        >
          <MiniLineSpark values={scaleSparkValues} />
        </BentoCard>

        <BentoCard
          label="Expenditure"
          value={checkin ? `${fmt(checkin.tdee)}` : "—"}
          sub={checkin ? "kcal TDEE" : "No check-in yet"}
          onClick={() => navigate("/expenditure")}
        >
          <MiniLineSpark values={tdeeSparkValues} />
        </BentoCard>

        <BentoCard
          label="Macros"
          value={last7.length > 0 ? `${fmt(avgCalories)}` : "—"}
          sub={last7.length > 0 ? "avg kcal/day, 7d" : "No logs yet"}
          onClick={() => navigate("/macros")}
        >
          <MiniBarSpark points={macroSparkPoints} />
        </BentoCard>
      </div>
    </section>
  );
}
