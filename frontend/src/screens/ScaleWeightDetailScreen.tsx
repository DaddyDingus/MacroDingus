import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { useWeights, useLogWeight, useDeleteWeight } from "../api/weights";
import { formatDayLabel, dayIndex, localDateString } from "../lib/date";
import { useWeightUnit, kgToUnit, unitToKg } from "../lib/weightUnit";
import { changeDirection, changeDirectionLabel } from "../lib/changeIndicator";
import { useChartGesture } from "../hooks/useChartGesture";
import { RANGE_PRESETS } from "../lib/chartLayout";
import ScaleWeightChart from "../components/ScaleWeightChart";
import ChartCard from "../components/ChartCard";
import ChangeDirectionIcon from "../components/ChangeDirectionIcon";
import ConfirmDeleteSheet from "../components/ConfirmDeleteSheet";
import { staggerStyle } from "../lib/stagger";

function formatRangeDate(dateStr: string, withYear: boolean): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: withYear ? "numeric" : undefined,
  });
}

function formatRangeLabel(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatRangeDate(endDate, true);
  return `${formatRangeDate(startDate, false)} – ${formatRangeDate(endDate, true)}`;
}

function signed(n: number): string {
  return n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

export default function ScaleWeightDetailScreen() {
  const { unit } = useWeightUnit();
  const [showHistory, setShowHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pendingDeleteWeightId, setPendingDeleteWeightId] = useState<string | null>(null);

  const allWeighIns = useWeights(3650);
  const logWeight = useLogWeight();
  const deleteWeight = useDeleteWeight();

  const allAsc = [...(allWeighIns.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const hasData = allAsc.length > 0;

  const earliestTs = useMemo(
    () => (allAsc.length ? dayIndex(allAsc[0].date) : dayIndex(localDateString())),
    [allAsc]
  );
  const gesture = useChartGesture({ earliestTs, initialDays: 30 });

  const rangePoints = useMemo(
    () => allAsc.filter((w) => dayIndex(w.date) >= gesture.view.start && dayIndex(w.date) <= gesture.view.end),
    [allAsc, gesture.view]
  );

  const rangeAvgKg = rangePoints.length ? rangePoints.reduce((sum, w) => sum + w.weightKg, 0) / rangePoints.length : null;
  const rangeDiffKg =
    rangePoints.length >= 2 ? rangePoints[rangePoints.length - 1].weightKg - rangePoints[0].weightKg : null;
  const rangeLabel = rangePoints.length ? formatRangeLabel(rangePoints[0].date, rangePoints[rangePoints.length - 1].date) : null;

  const withDelta = allAsc.map((w, i) => ({
    ...w,
    deltaKg: i > 0 ? Math.round((w.weightKg - allAsc[i - 1].weightKg) * 100) / 100 : null,
  }));
  const monthGroups = new Map<string, { label: string; entries: typeof withDelta }>();
  withDelta.forEach((w) => {
    const key = w.date.slice(0, 7);
    if (!monthGroups.has(key)) {
      const [y, m] = key.split("-").map(Number);
      monthGroups.set(key, {
        label: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        entries: [],
      });
    }
    monthGroups.get(key)!.entries.push(w);
  });
  const monthGroupsDesc = [...monthGroups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, g]) => ({ key, label: g.label, entries: [...g.entries].reverse() }));

  function startEdit(id: string, weightKg: number) {
    setEditingId(id);
    setEditValue(kgToUnit(weightKg, unit).toFixed(1));
  }

  function saveEdit(date: string) {
    const parsed = parseFloat(editValue);
    if (!Number.isNaN(parsed) && parsed > 0) {
      logWeight.mutate({ date, weightKg: unitToKg(parsed, unit) });
    }
    setEditingId(null);
  }

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-lg font-medium text-center">Scale Weight</h1>
      </header>

      <main className="px-4 space-y-3 max-w-md mx-auto">
        <div className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(0, 60, 5)}>
          <div className="relative grid grid-cols-2 gap-6">
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10" />
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Average</p>
              <p className="tabular text-2xl font-medium tracking-tight">
                {rangeAvgKg !== null ? kgToUnit(rangeAvgKg, unit).toFixed(1) : "—"}{" "}
                <span className="text-sm font-normal text-muted">{unit}</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[11px] tracking-widest uppercase text-muted">Difference</p>
              <p className="tabular text-2xl font-medium tracking-tight">
                {rangeDiffKg !== null ? signed(kgToUnit(rangeDiffKg, unit)) : "—"}{" "}
                <span className="text-sm font-normal text-muted">{unit}</span>
              </p>
            </div>
          </div>
          {rangeLabel && <p className="text-xs text-muted mt-2 text-center">{rangeLabel}</p>}
        </div>

        <div className="tile-enter" style={staggerStyle(1, 60, 5)}>
          <ChartCard gesture={gesture} presets={RANGE_PRESETS}>
            {(windowStart, windowEnd, height) => (
              <ScaleWeightChart
                points={rangePoints}
                hasData={hasData}
                unit={unit}
                windowStart={windowStart}
                windowEnd={windowEnd}
                height={height}
              />
            )}
          </ChartCard>
        </div>

        {monthGroupsDesc.length > 0 && (
          <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(2, 60, 5)}>
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-left"
            >
              <span className="text-[11px] tracking-widest uppercase text-muted">History</span>
              <span className="text-xs text-accent">{showHistory ? "Hide" : "Show"}</span>
            </button>
            {showHistory &&
              monthGroupsDesc.map((g) => (
                <div key={g.key}>
                  <div className="px-4 py-2 border-t border-line bg-surface-raised">
                    <span className="text-xs text-muted">{g.label}</span>
                  </div>
                  {g.entries.map((w) => {
                    const dir = changeDirection(w.deltaKg, 0.01);
                    const isEditing = editingId === w.id;
                    return (
                      <div key={w.id} className="flex items-center justify-between px-4 py-2.5 border-t border-line/60 gap-2">
                        {isEditing ? (
                          <div className="flex items-center gap-2 flex-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.1"
                              autoComplete="off"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit(w.date);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              autoFocus
                              className="w-20 bg-surface-raised border border-line rounded px-2 py-1 text-sm tabular focus:outline-none focus-within:border-accent"
                            />
                            <span className="text-xs text-muted">{unit}</span>
                          </div>
                        ) : (
                          <div>
                            <p className="tabular text-sm">
                              {kgToUnit(w.weightKg, unit).toFixed(1)} {unit}
                              {w.bodyFatPercent !== null && (
                                <span className="text-muted"> · {w.bodyFatPercent.toFixed(1)}% BF</span>
                              )}
                            </p>
                            <p className="text-xs text-muted">{formatDayLabel(w.date)}</p>
                          </div>
                        )}
                        <div className="flex items-center gap-3 shrink-0">
                          {isEditing ? (
                            <>
                              <button onClick={() => saveEdit(w.date)} className="text-xs text-accent">
                                Save
                              </button>
                              <button onClick={() => setEditingId(null)} className="text-xs text-muted">
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="flex items-center gap-1 text-xs text-muted">
                                <ChangeDirectionIcon direction={dir} colorClassName="text-weight" />
                                {changeDirectionLabel(dir)}
                              </span>
                              <button
                                onClick={() => startEdit(w.id, w.weightKg)}
                                aria-label={`Edit weigh-in from ${formatDayLabel(w.date)}`}
                                className="text-muted p-1"
                              >
                                <Pencil className="w-3.5 h-3.5" strokeWidth={2} />
                              </button>
                              <button
                                onClick={() => setPendingDeleteWeightId(w.id)}
                                aria-label={`Delete weigh-in from ${formatDayLabel(w.date)}`}
                                className="text-muted text-base leading-none px-1"
                              >
                                ×
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        )}
      </main>

      {pendingDeleteWeightId && (
        <ConfirmDeleteSheet
          title="Delete Weigh-In"
          message="Remove this weigh-in from your history? This can't be undone."
          confirmLabel="Delete Weigh-In"
          onConfirm={() => deleteWeight.mutate(pendingDeleteWeightId, { onSuccess: () => setPendingDeleteWeightId(null) })}
          onClose={() => setPendingDeleteWeightId(null)}
          isPending={deleteWeight.isPending}
        />
      )}
    </div>
  );
}
