import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCoachStatus, useSaveProfile, useCompleteOnboarding } from "../api/coach";
import WizardShell from "../components/WizardShell";
import WizardIllustration from "../components/WizardIllustration";
import BasicProfileForm from "../components/BasicProfileForm";
import LogWeightInline from "../components/LogWeightInline";

type Step = "welcome" | "profile" | "weight" | "skipping";

// Shown while a fresh account is missing a profile, or has a profile but
// hasn't finished onboarding yet (see the gate in App.tsx, keyed off
// profiles.onboardingCompletedAt). Two short local steps (no routing
// involved yet, same self-contained step-state pattern GoalWizardScreen/
// ProgramWizardScreen already use) collect a profile (Mifflin-St Jeor
// inputs) before handing off to the existing New Goal wizard — reused
// as-is, not reimplemented here. The weigh-in step is offered but optional:
// "Skip for now" finishes onboarding straight to the Dashboard instead
// (POST /api/profile/complete-onboarding — the alternate stamp to goal
// creation's, see routes/coach.ts), rather than forcing the Goal wizard on
// someone with no real weight to build a target around. Coached program
// generation needs a trend weight and will surface its own "Log at least
// one weight first" error if picked before one exists; the Dashboard's own
// "Set a goal" card (DashboardScreen.tsx) is what reminds a skip-weight
// user to come back and finish setting up a goal/program once they have.
export default function OnboardingFlow() {
  const navigate = useNavigate();
  const status = useCoachStatus();
  const saveProfile = useSaveProfile();
  const completeOnboarding = useCompleteOnboarding();
  const [step, setStep] = useState<Step>("welcome");

  // Only navigate away once the coach-status query itself reflects the
  // stamp (not immediately on the mutation's onSuccess, which fires before
  // the invalidated query has actually refetched) — jumping the gun would
  // land on "/" while the app's own onboarding gate still sees stale data
  // and bounces straight back here, same reasoning the weight-logged path
  // used to need before profile alone stopped being enough to leave.
  useEffect(() => {
    if (step === "skipping" && status.data?.profile?.onboardingCompletedAt) {
      navigate("/", { replace: true });
    }
  }, [step, status.data, navigate]);

  // Resume case: a profile already exists, so the gate only landed us here
  // because there's still no goal — e.g. the Goal wizard's own intro screen
  // was closed (its X navigates to /strategy) before actually creating one,
  // and the gate bounced straight back, or the user skipped the weigh-in
  // step last time. Skip replaying Welcome/Profile/Weight and go straight
  // back into goal creation. Only fires while step is still "welcome"
  // (freshly mounted, hasn't progressed locally).
  useEffect(() => {
    if (step === "welcome" && status.data?.profile) {
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
          <h1 className="text-2xl font-bold uppercase tracking-tight">Welcome to MacroDaddy</h1>
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
      <WizardShell title="About You" progress={1 / 2} onBack={() => setStep("welcome")} footer={null}>
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

  if (step === "weight" || step === "skipping") {
    return (
      <WizardShell
        title="Your Weight"
        progress={2 / 2}
        onBack={() => setStep("profile")}
        footer={
          <button
            onClick={() => {
              setStep("skipping");
              completeOnboarding.mutate();
            }}
            disabled={step === "skipping"}
            className="w-full py-3.5 rounded-full text-sm font-semibold text-muted bg-surface-raised disabled:opacity-40"
          >
            {step === "skipping" ? "Setting things up…" : "Skip for now"}
          </button>
        }
      >
        <h2 className="text-xl font-bold mb-1">What do you weigh today?</h2>
        <p className="text-xs text-muted mb-4">
          Logging a weigh-in now gives your calorie targets a real starting point instead of just an estimate — but
          you can skip this and log one later. You'll set up your goal once you have.
        </p>
        <LogWeightInline autoFocus onLogged={() => navigate("/strategy/new-goal", { replace: true })} />
      </WizardShell>
    );
  }

  return null;
}
