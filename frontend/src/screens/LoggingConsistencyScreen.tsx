import { useLoggedDates } from "../api/logs";
import ConsistencyCalendar from "../components/ConsistencyCalendar";

export default function LoggingConsistencyScreen() {
  const loggedDates = useLoggedDates();
  const activeDates = new Set(loggedDates.data?.dates ?? []);

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium">Logging consistency</h1>
      </header>

      <main className="px-4 max-w-md mx-auto">
        <ConsistencyCalendar activeDates={activeDates} />
      </main>
    </div>
  );
}
