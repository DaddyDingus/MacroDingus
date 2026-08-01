import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCoachStatus, useSaveProfile } from "../api/coach";
import WizardShell from "../components/WizardShell";
import WizardIllustration from "../components/WizardIllustration";
import BasicProfileForm from "../components/BasicProfileForm";
import LogWeightInline from "../components/LogWeightInline";

type Step = "welcome" | "profile" | "weight" | "finishing";

// Shown while a fresh account is missing a profile, a weigh-in, or a goal
// (see the onboarding gate in App.tsx). Three short local steps (no routing
// involved yet, same self-contained step-state pattern GoalWizardScreen/
// ProgramWizardScreen already use) collect exactly what the coaching engine
// needs before anything else in the app can compute a real number: a
// profile (Mifflin-St Jeor inputs) and one weigh-in (the trend-weight
// anchor everything else builds from). Once both exist, control hands off
// to the existing New Goal wizard — reused as-is, not reimplemented here.
export default function OnboardingFlow() {
  const navigate = useNavigate();
  const status = useCoachStatus();
  const saveProfile = useSaveProfile();
  const [step, setStep] = useState<Step>("welcome");

  // Resume case: profile + weigh-in already exist, so the gate only landed
  // us here because there's still no goal — e.g. the Goal wizard's own
  // intro screen was closed (its X navigates to /strategy) before actually
  // creating one, and the gate bounced straight back. Skip replaying
  // Welcome/Profile/Weight and go straight back into goal creation. Only
  // fires while step is still "welcome" (freshly mounted, hasn't
  // progressed locally) so it can't fight the "finishing" handoff below.
  useEffect(() => {
    if (step === "welcome" && status.data?.profile && status.data.trendWeightKg !== null) {
      navigate("/strategy/new-goal", { replace: true });
    }
  }, [step, status.data, navigate]);

  // Only navigate away once the coach-status query itself reflects the new
  // weigh-in (trendWeightKg no longer null) — not immediately on the
  // mutation's onSuccess, which fires before the invalidated query has
  // actually refetched. Jumping the gun here would land on /strategy/new-goal
  // while the app's own onboarding gate (also reading this same query) still
  // sees stale data and bounces straight back to this screen.
  useEffect(() => {
    if (step === "finishing" && status.data?.profile && status.data.trendWeightKg !== null) {
      navigate("/strategy/new-goal", { replace: true });
    }
  }, [step, status.data, navigate]);

  if (step === "welcome") {
    return (
      <div className="min-h-dvh flex flex-col">
        <div className="p-4 shrink-0">
          <WizardIllustration variant="goal" />
        </div>
        <div className="flex-1 px-4 pt-2">
          <h1 className="text-2xl font-bold uppercase tracking-tight">Welcome to macrotrack</h1>
          <p className="text-sm text-muted mt-3">
            A few quick steps to get your plan set up — a little about you, your current weight, then your goal.
            Takes about a minute.
          </p>
        </div>
        <div className="px-4 pb-6 shrink-0">
          <button
            onClick={() => setStep("profile")}
            className="w-full py-3.5 rounded-full text-sm font-semibold"
            style={{ background: "#ECEDEE", color: "#0B1210" }}
          >
            Get Started
          </button>
        </div>
      </div>
    );
  }

  if (step === "profile") {
    return (
      <WizardShell title="About You" progress={1 / 3} onBack={() => setStep("welcome")} footer={null}>
        <h2 className="text-xl font-bold mb-1">Tell us about yourself</h2>
        <p className="text-xs text-muted mb-4">
          This feeds your expenditure estimate until you've logged enough data for it to work from your real numbers.
        </p>
        <BasicProfileForm
          saving={saveProfile.isPending}
          onSave={(input) => saveProfile.mutate(input, { onSuccess: () => setStep("weight") })}
        />
      </WizardShell>
    );
  }

  if (step === "weight" || step === "finishing") {
    return (
      <WizardShell title="Your Weight" progress={2 / 3} onBack={() => setStep("profile")} footer={null}>
        <h2 className="text-xl font-bold mb-1">What do you weigh today?</h2>
        <p className="text-xs text-muted mb-4">
          We need at least one weigh-in to estimate your calorie needs — this becomes the baseline everything else
          builds from.
        </p>
        <LogWeightInline autoFocus onLogged={() => setStep("finishing")} />
        {step === "finishing" && <p className="text-xs text-muted text-center mt-4">Setting up your plan…</p>}
      </WizardShell>
    );
  }

  return null;
}
