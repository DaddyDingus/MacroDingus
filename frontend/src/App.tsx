import { useQuery } from "@tanstack/react-query";

interface Health {
  ok: boolean;
  time: string;
}

async function fetchHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error("backend unreachable");
  return res.json();
}

export default function App() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  const status = isLoading ? "checking" : isError ? "unreachable" : "online";
  const statusColor =
    status === "online" ? "text-accent" : status === "checking" ? "text-muted" : "text-protein";

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm border border-line bg-surface rounded-md overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <p className="text-xs tracking-widest uppercase text-muted">Nutrition &amp; Coaching</p>
          <h1 className="text-3xl font-semibold tracking-tight">macrotrack</h1>
        </div>

        <div className="h-[3px] bg-ink" />

        <div className="px-5 py-3 flex items-center justify-between border-b border-line">
          <span className="text-sm text-muted">Backend</span>
          <span className={`tabular text-sm ${statusColor}`}>{status}</span>
        </div>
        <div className="px-5 py-3 flex items-center justify-between border-b border-line">
          <span className="text-sm text-muted">Last check</span>
          <span className="tabular text-sm text-ink">
            {data?.time ? new Date(data.time).toLocaleTimeString() : "—"}
          </span>
        </div>
        <div className="px-5 py-3 flex items-center justify-between">
          <span className="text-sm text-muted">Build phase</span>
          <span className="tabular text-sm text-ink">0 · foundation</span>
        </div>
      </div>

      <p className="mt-6 text-xs text-muted text-center max-w-xs">
        Scaffold is live. Logging, food data, and coaching land in the phases after this.
      </p>
    </div>
  );
}
