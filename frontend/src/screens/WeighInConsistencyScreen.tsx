import { useWeights } from "../api/weights";
import ConsistencyCalendar from "../components/ConsistencyCalendar";

export default function WeighInConsistencyScreen() {
  const weighIns = useWeights(3650);
  const activeDates = new Set((weighIns.data ?? []).map((w) => w.date));

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium">Weigh-in consistency</h1>
      </header>

      <main className="px-4 max-w-md mx-auto">
        <ConsistencyCalendar activeDates={activeDates} />
      </main>
    </div>
  );
}
