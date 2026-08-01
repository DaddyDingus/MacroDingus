import { useNavigate } from "react-router-dom";
import { useCoachStatus } from "../api/coach";
import WizardShell from "../components/WizardShell";
import WeeklyProgramGrid from "../components/WeeklyProgramGrid";

const STYLE_LABELS: Record<string, string> = { coached: "Coached", manual: "Manual" };

// Reached after editing a goal whose rate didn't change (see GoalWizardScreen's
// currentProgramStillValid()) — the existing program's targets are still
// exactly what generateCoachedProgramDays would produce again, so there's
// nothing to regenerate. Mirrors MacroFactor's own "Do your program
// preferences still look good to you?" screen: show what's already running
// and let the user either keep it or start fresh, rather than silently
// forcing a brand new program wizard every time a goal is touched at all.
export default function ProgramReviewScreen() {
  const navigate = useNavigate();
  const status = useCoachStatus();

  if (status.isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  const activeProgram = status.data?.activeProgram ?? null;
  const goalId = status.data?.activeGoal?.id ?? null;
  const newProgramHref = goalId ? `/strategy/new-program?goalId=${goalId}` : "/strategy/new-program";

  // Nothing to review (e.g. reached directly with no active program) — same
  // destination editing the goal would have sent you to anyway.
  if (!activeProgram) {
    navigate(newProgramHref, { replace: true });
    return null;
  }

  return (
    <WizardShell
      title="Edit Goal"
      progress={1}
      onBack={() => navigate("/strategy")}
      footer={
        <div className="space-y-2">
          <button
            onClick={() => navigate(newProgramHref)}
            className="w-full py-3.5 rounded-full text-sm font-semibold text-muted bg-surface-raised"
          >
            Set New Program
          </button>
          <button
            onClick={() => navigate("/strategy")}
            className="w-full py-3.5 rounded-full text-sm font-semibold"
            style={{ background: "#ECEDEE", color: "#0B1210" }}
          >
            Looks Good
          </button>
        </div>
      }
    >
      <h2 className="text-lg font-bold mb-4">Do your program preferences still look good to you?</h2>
      <div className="border border-line bg-surface rounded-2xl overflow-hidden mb-4">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-medium">Program Style</span>
          <span className="text-sm text-muted">{STYLE_LABELS[activeProgram.style] ?? activeProgram.style}</span>
        </div>
      </div>
      <div className="border border-line bg-surface rounded-2xl p-4">
        <WeeklyProgramGrid
          days={activeProgram.days.map((d) => ({
            dayOfWeek: d.dayOfWeek,
            calories: d.targetCalories,
            proteinG: d.targetProteinG,
            carbsG: d.targetCarbsG,
            fatG: d.targetFatG,
          }))}
          unit="kcal"
        />
      </div>
    </WizardShell>
  );
}
