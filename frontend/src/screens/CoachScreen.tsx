import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, RotateCw, Target, Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { useCoachStatus, useSaveProfile, useCheckIn, type ActivityLevel } from "../api/coach";
import { useGoals, useDeleteGoal } from "../api/goals";
import { useWeightUnit, kgToUnit } from "../lib/weightUnit";
import { daysBetween, localDateString } from "../lib/date";
import { computeGoalProgressPercent } from "../lib/goalProgress";
import ChangeCheckInDaySheet from "../components/ChangeCheckInDaySheet";
import CheckInResultSheet from "../components/CheckInResultSheet";
import LogWeightFirstSheet from "../components/LogWeightFirstSheet";
import WeeklyProgramGrid from "../components/WeeklyProgramGrid";
import BasicProfileForm from "../components/BasicProfileForm";
import ConfirmDeleteSheet from "../components/ConfirmDeleteSheet";
import { staggerStyle } from "../lib/stagger";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function Pill({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-line text-xs whitespace-nowrap shrink-0"
    >
      {icon}
      {label}
    </button>
  );
}

// The concentric progress rings on the main Strategy screen — outer (green)
// is goal progress, inner (ink, or orange once overdue) is how far through
// the check-in cycle you are. checkInPercent is progress toward
// nextCheckinDueDate (see backend/src/lib/checkinSchedule.ts), not a flat
// /7 — the cycle can run shorter than 7 days right after changing the
// check-in weekday, since the next due date is the next occurrence of that
// weekday, not always a full week out.
function DualRing({
  goalPercent,
  checkInPercent,
  centerValue,
  centerLabel,
  urgent,
}: {
  goalPercent: number;
  checkInPercent: number;
  centerValue: string;
  centerLabel: string;
  urgent?: boolean;
}) {
  const size = 220;
  const strokeWidth = 11;
  const outerR = size / 2 - strokeWidth;
  const innerR = outerR - strokeWidth - 8;
  const outerCirc = 2 * Math.PI * outerR;
  const innerCirc = 2 * Math.PI * innerR;
  const c = size / 2;
  const innerColor = urgent ? "#D95926" : "#ECEDEE";

  return (
    <svg width={size} height={size} className="mx-auto block">
      <circle cx={c} cy={c} r={outerR} stroke="rgba(236,237,238,0.08)" strokeWidth={strokeWidth} fill="none" />
      <circle
        cx={c}
        cy={c}
        r={outerR}
        stroke="#059669"
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={outerCirc}
        strokeDashoffset={outerCirc * (1 - goalPercent)}
        transform={`rotate(-90 ${c} ${c})`}
      />
      <circle cx={c} cy={c} r={innerR} stroke="rgba(236,237,238,0.08)" strokeWidth={strokeWidth} fill="none" />
      <circle
        cx={c}
        cy={c}
        r={innerR}
        stroke={innerColor}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={innerCirc}
        strokeDashoffset={innerCirc * (1 - checkInPercent)}
        transform={`rotate(-90 ${c} ${c})`}
      />
      <text x="50%" y="47%" textAnchor="middle" fill={innerColor} fontSize="30" fontWeight="700">
        {centerValue}
      </text>
      <text x="50%" y="58%" textAnchor="middle" fill="#8A8F98" fontSize="12">
        {centerLabel}
      </text>
    </svg>
  );
}

export default function CoachScreen() {
  const navigate = useNavigate();
  const status = useCoachStatus();
  const saveProfile = useSaveProfile();
  const checkIn = useCheckIn();
  const goals = useGoals();
  const deleteGoal = useDeleteGoal();
  const { unit } = useWeightUnit();
  const [showCheckInDaySheet, setShowCheckInDaySheet] = useState(false);
  const [checkInResult, setCheckInResult] = useState<{ checkin: NonNullable<ReturnType<typeof useCoachStatus>["data"]>["latestCheckin"]; usedAdaptiveTdee: boolean } | null>(null);
  const [pendingDeleteGoalId, setPendingDeleteGoalId] = useState<string | null>(null);
  const [narrativeExpanded, setNarrativeExpanded] = useState(false);
  const [weightPromptOpen, setWeightPromptOpen] = useState(false);

  if (status.isLoading) return null;

  const profile = status.data?.profile ?? null;

  if (!profile) {
    return <BasicProfileSetup saving={saveProfile.isPending} onSave={(input) => saveProfile.mutate(input)} />;
  }

  const activeGoal = status.data?.activeGoal ?? null;
  const activeProgram = status.data?.activeProgram ?? null;
  const trendWeightKg = status.data?.trendWeightKg ?? null;
  const daysSinceCheckin = status.data?.daysSinceCheckin ?? null;

  function goToNewGoal() {
    if (trendWeightKg != null) navigate("/strategy/new-goal");
    else setWeightPromptOpen(true);
  }
  const nextCheckinDueDate = status.data?.nextCheckinDueDate ?? null;
  const latestCheckinDate = status.data?.latestCheckin?.date ?? null;

  const today = status.data?.currentDate ?? localDateString();
  const isCheckinDue = nextCheckinDueDate !== null && nextCheckinDueDate <= today;
  const daysOverdue = isCheckinDue ? daysBetween(nextCheckinDueDate!, today) : 0;
  const daysUntilDue = nextCheckinDueDate !== null && !isCheckinDue ? daysBetween(today, nextCheckinDueDate) : null;

  const goalPercent =
    activeGoal?.goalWeightKg != null && activeGoal.startWeightKg != null && trendWeightKg != null
      ? computeGoalProgressPercent(activeGoal.startWeightKg, activeGoal.goalWeightKg, trendWeightKg) / 100
      : 0;
  // Progress through the current cycle (last check-in -> next due date), not
  // a flat /7 — see DualRing's comment above.
  const cycleLength =
    latestCheckinDate && nextCheckinDueDate ? Math.max(1, daysBetween(latestCheckinDate, nextCheckinDueDate)) : 7;
  const checkInPercent = daysSinceCheckin === null ? 0 : Math.min(1, daysSinceCheckin / cycleLength);

  const allGoalsDesc = [...(goals.data ?? [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const pastGoals = allGoalsDesc.filter((g) => g.id !== activeGoal?.id);

  let block = 0;

  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-3xl font-bold uppercase tracking-tight">Strategy</h1>
      </header>

      <main className="px-4 pt-4 space-y-3 max-w-md mx-auto">
        <button
          onClick={() => setShowCheckInDaySheet(true)}
          aria-label="Change check-in day"
          className="tile-enter block w-full active:opacity-70 transition-opacity"
          style={staggerStyle(block++, 60, 5)}
        >
          <DualRing
            goalPercent={goalPercent}
            checkInPercent={checkInPercent}
            urgent={isCheckinDue}
            centerValue={
              daysSinceCheckin === null ? "—" : isCheckinDue ? String(daysOverdue) : daysUntilDue !== null ? String(daysUntilDue) : String(daysSinceCheckin)
            }
            centerLabel={
              daysSinceCheckin === null
                ? "no check-ins yet"
                : isCheckinDue
                  ? daysOverdue === 0
                    ? "check-in due today"
                    : "days overdue"
                  : "days until check-in"
            }
          />
        </button>

        <div className="flex items-center justify-center gap-6 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5" style={{ color: "#059669" }} strokeWidth={2} />
            Goal
          </span>
          <span className="flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5 text-ink" strokeWidth={2} />
            Check-In
          </span>
        </div>

        {/* Only rendered when a check-in is actually actionable (no prior
            check-in yet, or the weekly one is due/overdue) — no need for a
            disabled button sitting around explaining itself for the six
            days it can't be used. The ring above already shows progress
            toward the next one. */}
        {(nextCheckinDueDate === null || isCheckinDue) && (
          <>
            <div className="tile-enter border border-line bg-surface rounded-2xl p-4 flex items-center justify-between gap-3" style={staggerStyle(block++, 60, 5)}>
              <p className="text-sm text-muted flex-1 min-w-0 truncate">
                {nextCheckinDueDate === null
                  ? "You haven't checked in yet."
                  : daysOverdue === 0
                    ? "Your check-in is due today."
                    : `Your check-in is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue.`}
              </p>
              <button
                onClick={() =>
                  checkIn.mutate(undefined, {
                    onSuccess: (data) => setCheckInResult(data),
                  })
                }
                disabled={checkIn.isPending}
                className="px-5 py-2.5 rounded-full text-sm font-semibold disabled:opacity-50 shrink-0"
                style={{ background: "#ECEDEE", color: "#0B1210" }}
              >
                {checkIn.isPending ? "Checking in…" : "Check In"}
              </button>
            </div>
            {checkIn.isError && (
              <p className="text-xs text-red-400 text-center">
                {checkIn.error instanceof Error ? checkIn.error.message : "Couldn't check in."}
              </p>
            )}
          </>
        )}

        {/* Same narrative the Dashboard's "Weekly update" tile shows (just
            the latest one, full text here since there's a full column's
            width to use) — collapsed by default since it's prose, not a
            stat, and this screen already leads with the check-in ring;
            expand/collapse uses the same grid-rows (0fr/1fr) trick as
            PhotosScreen's Measurements section for a smooth height
            animation without measuring the text's real height up front. */}
        {status.data?.latestCheckin?.narrative && (
          <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
            <button
              type="button"
              onClick={() => setNarrativeExpanded((v) => !v)}
              className="w-full flex items-center justify-between p-4 text-left"
            >
              <p className="text-sm font-semibold">Weekly Update</p>
              <ChevronDown
                className={`w-4 h-4 text-muted transition-transform shrink-0 ${narrativeExpanded ? "rotate-180" : ""}`}
                strokeWidth={2}
              />
            </button>
            <div
              className="grid transition-[grid-template-rows] duration-300 ease-out"
              style={{ gridTemplateRows: narrativeExpanded ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-sm text-muted leading-relaxed">{status.data.latestCheckin.narrative}</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate("/checkin-journal");
                    }}
                    className="text-xs text-accent font-medium"
                  >
                    View full journal →
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <p className="text-lg font-bold pt-3">In Progress</p>

        {activeProgram ? (
          <div className="tile-enter border border-line bg-surface rounded-2xl p-4 space-y-3" style={staggerStyle(block++, 60, 5)}>
            <div>
              <p className="text-sm font-semibold">{activeProgram.style === "coached" ? "Coached Program" : "Manual Program"}</p>
              <p className="text-xs text-muted mt-0.5">{formatDate(activeProgram.startedAt)} – Now</p>
            </div>
            <WeeklyProgramGrid
              days={activeProgram.days.map((d) => ({ dayOfWeek: d.dayOfWeek, calories: d.targetCalories, proteinG: d.targetProteinG, carbsG: d.targetCarbsG, fatG: d.targetFatG }))}
              unit="kcal"
            />
            <div className="flex gap-2 pt-1">
              <Pill icon={<RotateCw className="w-3.5 h-3.5" strokeWidth={2} />} label="New Program" onClick={() => navigate("/strategy/new-program")} />
              <Pill icon={<Pencil className="w-3.5 h-3.5" strokeWidth={2} />} label="Edit Program" onClick={() => navigate("/strategy/edit-program")} />
            </div>
          </div>
        ) : activeGoal ? (
          <div className="tile-enter border border-line bg-surface rounded-2xl p-4" style={staggerStyle(block++, 60, 5)}>
            <p className="text-sm text-muted mb-2">No program set up for this goal yet.</p>
            <Pill icon={<Plus className="w-3.5 h-3.5" strokeWidth={2} />} label="New Program" onClick={() => navigate("/strategy/new-program")} />
          </div>
        ) : null}

        {activeGoal && (
          <div className="tile-enter border border-line bg-surface rounded-2xl p-4 space-y-3" style={staggerStyle(block++, 60, 5)}>
            <div>
              <p className="text-sm font-semibold">
                {activeGoal.goalType === "cut" ? "Weight Loss Goal" : activeGoal.goalType === "bulk" ? "Weight Gain Goal" : "Maintenance Goal"}
              </p>
              <p className="text-xs text-muted mt-0.5">{formatDate(activeGoal.startedAt)} – Now</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="tabular text-lg font-bold">
                  {activeGoal.goalWeightKg != null ? kgToUnit(activeGoal.goalWeightKg, unit).toFixed(1) : "—"}
                  <span className="text-xs font-normal text-muted">{unit}</span>
                </p>
                <p className="text-[11px] text-muted mt-0.5">Goal Weight</p>
              </div>
              <div>
                <p className="tabular text-lg font-bold">
                  {activeGoal.targetRateKgPerWeek >= 0 ? "+" : ""}
                  {kgToUnit(activeGoal.targetRateKgPerWeek, unit).toFixed(2)}
                  <span className="text-xs font-normal text-muted">{unit}</span>
                </p>
                <p className="text-[11px] text-muted mt-0.5">Goal Rate</p>
              </div>
              <div>
                <p className="tabular text-lg font-bold">
                  {trendWeightKg
                    ? `${activeGoal.targetRateKgPerWeek >= 0 ? "+" : ""}${((activeGoal.targetRateKgPerWeek / trendWeightKg) * 100).toFixed(1)}`
                    : "—"}
                  <span className="text-xs font-normal text-muted">%</span>
                </p>
                <p className="text-[11px] text-muted mt-0.5">Goal Rate</p>
              </div>
            </div>
            <div className="flex gap-2 pt-1 flex-wrap">
              <Pill icon={<Plus className="w-3.5 h-3.5" strokeWidth={2} />} label="New Goal" onClick={goToNewGoal} />
              <Pill icon={<Pencil className="w-3.5 h-3.5" strokeWidth={2} />} label="Edit Goal" onClick={() => navigate("/strategy/edit-goal")} />
            </div>
          </div>
        )}

        {pastGoals.length > 0 && (
          <>
            <p className="text-lg font-bold pt-3">Goal History</p>
            <div className="tile-enter border border-line bg-surface rounded-2xl overflow-hidden" style={staggerStyle(block++, 60, 5)}>
              {pastGoals.map((g) => (
                <div key={g.id} className="flex items-center justify-between px-4 py-3 border-b border-line/60 last:border-b-0">
                  <div>
                    <p className="text-xs text-muted">
                      {formatDate(g.startedAt)} – {g.endedAt ? formatDate(g.endedAt) : "Now"}
                    </p>
                    <p className="tabular text-sm mt-0.5">{g.goalWeightKg != null ? `${kgToUnit(g.goalWeightKg, unit).toFixed(1)} ${unit}` : "Maintain"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted">{g.goalType === "cut" ? "Loss" : g.goalType === "bulk" ? "Gain" : "Maintain"}</span>
                    <button
                      onClick={() => setPendingDeleteGoalId(g.id)}
                      aria-label={`Delete ${formatDate(g.startedAt)} goal`}
                      className="text-muted text-base leading-none px-1"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {showCheckInDaySheet && (
        <ChangeCheckInDaySheet
          value={profile.checkInDayOfWeek}
          onSelect={(dayOfWeek) => saveProfile.mutate({ ...profile, checkInDayOfWeek: dayOfWeek })}
          onClose={() => setShowCheckInDaySheet(false)}
        />
      )}
      {checkInResult?.checkin && (
        <CheckInResultSheet checkin={checkInResult.checkin} usedAdaptiveTdee={checkInResult.usedAdaptiveTdee} onClose={() => setCheckInResult(null)} />
      )}
      {weightPromptOpen && (
        <LogWeightFirstSheet onClose={() => setWeightPromptOpen(false)} onContinue={() => navigate("/strategy/new-goal")} />
      )}
      {pendingDeleteGoalId && (
        <ConfirmDeleteSheet
          title="Delete Goal"
          message="Remove this goal from your history? This can't be undone."
          confirmLabel="Delete Goal"
          onConfirm={() => deleteGoal.mutate(pendingDeleteGoalId, { onSuccess: () => setPendingDeleteGoalId(null) })}
          onClose={() => setPendingDeleteGoalId(null)}
          isPending={deleteGoal.isPending}
        />
      )}
    </div>
  );
}

// No screenshot covered basic-profile setup since MacroFactor collects that
// during its own onboarding, not on the Strategy tab — but this app's
// coaching engine still needs it for the formula fallback, so a minimal
// form lives here rather than leaving new users with no way to provide it.
function BasicProfileSetup({ saving, onSave }: { saving: boolean; onSave: (input: { sex: "male" | "female"; birthYear: number; heightCm: number; activityLevel: ActivityLevel; checkInDayOfWeek: number | null; weeklyExerciseHours: number | null }) => void }) {
  return (
    <div className="min-h-dvh pb-24">
      <header className="px-4 pt-5 pb-3">
        <h1 className="text-3xl font-bold uppercase tracking-tight">Strategy</h1>
        <p className="text-sm text-muted mt-2">A few basics first — this feeds your expenditure estimate until you've logged enough data for it to work from your real numbers.</p>
      </header>
      <main className="px-4 max-w-md mx-auto">
        <BasicProfileForm saving={saving} onSave={onSave} />
      </main>
    </div>
  );
}
