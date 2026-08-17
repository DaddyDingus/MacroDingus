import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TrendingDown, Equal, TrendingUp } from "lucide-react";
import { useCoachStatus, type CoachStatus } from "../api/coach";
import { useCreateGoal, useEditGoal } from "../api/goals";
import { useWeightUnit, kgToUnit, unitToKg } from "../lib/weightUnit";
import { localDateString } from "../lib/date";
import { computeOptimisticEtaDate } from "../lib/goalProgressInsights";
import {
  type GoalTypeValue,
  recommendedRateRangeKgPerWeek,
  isWithinRecommendedRange,
  defaultRateKgPerWeek,
  rateSliderBoundsKgPerWeek,
  impliedDeficitFraction,
  DEEP_DEFICIT_FRACTION,
} from "../lib/goalRateGuidance";
import WizardShell from "../components/WizardShell";
import WizardIntroCard, { type WizardIntroStep } from "../components/WizardIntroCard";
import WizardOption from "../components/WizardOption";
import { useBackDismissDepth } from "../lib/useBackDismiss";
import DecimalInput from "../components/DecimalInput";
import { apiFetch } from "../api/client";

type Step = "intro" | "type" | "target" | "summary";

function formatFullDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

// Abbreviated month, used only in the narrow "projected end date" preview
// card — that card is half the row width of a full-width row, so the full
// month name from formatFullDate (used elsewhere, where it fits) routinely
// wrapped to a second line there and pushed the rest of the screen down.
function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const WEIGHT_SLIDER_ABS_MIN_KG = 30;
const WEIGHT_SLIDER_ABS_MAX_KG = 200;

// A cut's target weight only makes sense below current trend weight; a
// bulk's only above it — otherwise "lose weight, target 90kg" from a
// current 80kg (or the reverse for a bulk) is a contradiction the UI
// shouldn't let you land on. Maintain never reaches the weight slider
// (goalWeightKg is forced null and the wizard skips straight to summary).
function weightSliderBoundsKg(goalType: GoalTypeValue, trendWeightKg: number | null): { min: number; max: number } {
  if (trendWeightKg === null) return { min: WEIGHT_SLIDER_ABS_MIN_KG, max: WEIGHT_SLIDER_ABS_MAX_KG };
  if (goalType === "cut") return { min: WEIGHT_SLIDER_ABS_MIN_KG, max: trendWeightKg };
  if (goalType === "bulk") return { min: trendWeightKg, max: WEIGHT_SLIDER_ABS_MAX_KG };
  return { min: WEIGHT_SLIDER_ABS_MIN_KG, max: WEIGHT_SLIDER_ABS_MAX_KG };
}

function defaultGoalWeightKg(goalType: GoalTypeValue, trendWeightKg: number | null): number | null {
  if (trendWeightKg === null) return null;
  const delta = goalType === "bulk" ? 5 : -5;
  return Math.round((trendWeightKg + delta) * 10) / 10;
}

export default function GoalWizardScreen({ mode }: { mode: "new" | "edit" }) {
  const navigate = useNavigate();
  const status = useCoachStatus();

  if (status.isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }
  if (mode === "edit" && !status.data?.activeGoal) {
    navigate("/strategy", { replace: true });
    return null;
  }

  return <GoalWizardBody mode={mode} status={status.data!} />;
}

function GoalWizardBody({ mode, status }: { mode: "new" | "edit"; status: CoachStatus }) {
  const navigate = useNavigate();
  const { unit } = useWeightUnit();
  const createGoal = useCreateGoal();
  const editGoal = useEditGoal();

  const activeGoal = status.activeGoal;
  const trendWeightKg = status.trendWeightKg;
  const latestTdee = status.latestCheckin?.tdee ?? null;
  const today = localDateString();

  const [step, setStep] = useState<Step>("intro");

  const [goalType, setGoalType] = useState<GoalTypeValue>(
    mode === "edit" && activeGoal ? (activeGoal.goalType as GoalTypeValue) : "cut"
  );
  const [goalWeightKg, setGoalWeightKg] = useState<number | null>(() => {
    if (mode === "edit" && activeGoal) {
      if (activeGoal.goalWeightKg === null) return null; // maintain
      // Defensive clamp — same reasoning as the rate clamp above, for a
      // stored goal weight that predates this restriction.
      const bounds = weightSliderBoundsKg(activeGoal.goalType as GoalTypeValue, trendWeightKg);
      return clamp(activeGoal.goalWeightKg, bounds.min, bounds.max);
    }
    return defaultGoalWeightKg("cut", trendWeightKg);
  });
  const [rateKgPerWeek, setRateKgPerWeek] = useState<number>(() => {
    if (mode === "edit" && activeGoal) {
      // Defensive clamp — an existing goal's stored rate should already
      // match its sign, but this guards against stale data (e.g. from
      // before this restriction existed) putting the slider out of bounds.
      const bounds = rateSliderBoundsKgPerWeek(activeGoal.goalType as GoalTypeValue, trendWeightKg);
      const rate = activeGoal.targetRatePercentPerWeek !== null && trendWeightKg !== null
        ? (activeGoal.targetRatePercentPerWeek / 100) * trendWeightKg
        : activeGoal.targetRateKgPerWeek;
      return clamp(rate, bounds.min, bounds.max);
    }
    return defaultRateKgPerWeek("cut", trendWeightKg);
  });
  const weeklyPctBw = trendWeightKg ? (rateKgPerWeek / trendWeightKg) * 100 : null;

  const introTitle = mode === "new" ? "New Goal" : "Edit Goal";
  const introSteps: WizardIntroStep[] = [
    {
      label: mode === "new" ? "Set new goal" : "Edit goal",
      description: mode === "new" ? "Choose goal weight and rate of change" : "Modify goal weight and rate of weight change",
      status: "active",
    },
  ];

  // Single source of truth for "back" within the wizard's own steps — shared
  // by the WizardShell chevron button (below) and the hardware/gesture back
  // button (via useBackDismiss just below). Without the latter, the browser
  // back gesture skipped the wizard's own step history entirely (nothing
  // pushes a history entry per step, only the wizard's route itself), so one
  // back press from any step deeper than the first jumped straight out of
  // the whole wizard to wherever /strategy/new-goal was opened from — same
  // bug class useBackDismiss already fixed for every sheet/modal in the app,
  // just never wired up for this linear stepper shape.
  // Pure, so the step depth below can walk the same chain goBack takes and
  // the two can't drift. null = "intro", the bottom of the wizard.
  function previousStep(from: Step): Step | null {
    if (from === "intro") return null;
    if (from === "target") return mode === "new" ? "type" : "intro";
    if (from === "summary") return goalType === "maintain" ? "type" : "target";
    return "intro";
  }

  function goBack() {
    const previous = previousStep(step);
    if (previous) setStep(previous);
  }

  // One history entry per step between here and "intro" — not one trap that
  // re-arms itself per press, which exited the app outright on the second
  // press (see lib/useBackDismiss.ts). Zero on "intro" itself: that step sits
  // on a real route (/strategy/new-goal), so back there falls through to
  // normal browser history and lands on /strategy, exactly like the intro
  // screen's own X button.
  let backDepth = 0;
  for (let s = previousStep(step); s; s = previousStep(s)) backDepth++;
  useBackDismissDepth(backDepth, goBack);

  const distanceKg = goalWeightKg !== null && trendWeightKg !== null ? Math.abs(goalWeightKg - trendWeightKg) : null;
  const previewTdee = latestTdee;
  const previewTargetCalories = previewTdee !== null ? Math.round(previewTdee + (rateKgPerWeek * 7700) / 7) : null;
  const previewEndDate =
    distanceKg !== null && rateKgPerWeek !== 0 ? computeOptimisticEtaDate(distanceKg, rateKgPerWeek, today) : null;

  function selectGoalType(t: GoalTypeValue) {
    setGoalType(t);
    setRateKgPerWeek(defaultRateKgPerWeek(t, trendWeightKg));
    if (t === "maintain") {
      setGoalWeightKg(null);
      setStep("summary");
    } else {
      // Re-seed the goal weight too — the previous type's default (or a
      // leftover cut-style "5kg below current") is on the wrong side of
      // current weight for the newly-selected type otherwise.
      setGoalWeightKg(defaultGoalWeightKg(t, trendWeightKg));
      setStep("target");
    }
  }

  function saveGoal() {
    const input = { goalType, goalWeightKg, targetRateKgPerWeek: rateKgPerWeek, targetRatePercentPerWeek: weeklyPctBw };
    if (mode === "new") {
      createGoal.mutate(input, {
        onSuccess: (goal) => {
          // A new goal closes the old program, so its macro grid is no
          // longer a meaningful preview. Go directly to the preferences that
          // determine the replacement; the first grid the user sees is the
          // newly generated program, not stale targets.
          navigate(`/strategy/new-program?goalId=${goal.id}`);
        },
      });
    } else if (activeGoal) {
      const rateChanged = activeGoal.targetRatePercentPerWeek !== null && weeklyPctBw !== null
        ? activeGoal.targetRatePercentPerWeek !== weeklyPctBw
        : activeGoal.targetRateKgPerWeek !== rateKgPerWeek;
      editGoal.mutate(
        { id: activeGoal.id, goalWeightKg, targetRateKgPerWeek: rateKgPerWeek, targetRatePercentPerWeek: weeklyPctBw },
        {
          onSuccess: async () => {
            let programUpdateFailed = false;
            const activeProgram = status.activeProgram;
            if (
              rateChanged &&
              activeProgram?.style === "coached" &&
              activeProgram.distributionMode !== "custom"
            ) {
              try {
                await apiFetch(`/programs/${activeProgram.id}/regenerate?preserveDistribution=1`, { method: "POST" });
              } catch {
                programUpdateFailed = true;
              }
            }
            // A real document navigation discards the completed wizard's
            // mounted state. The review route explicitly refetches fresh
            // server data before displaying the saved goal/program.
            window.location.replace(
              `/strategy/review-program?goalSaved=1${programUpdateFailed ? "&programUpdateFailed=1" : ""}`
            );
          },
        }
      );
    }
  }

  if (step === "intro") {
    return (
      <WizardIntroCard
        title={introTitle}
        illustration="goal"
        steps={introSteps}
        ctaLabel={mode === "new" ? "Set New Goal" : "Edit Goal Parameters"}
        onClose={() => navigate("/strategy")}
        onCta={() => setStep(mode === "new" ? "type" : "target")}
      />
    );
  }

  if (step === "type") {
    return (
      <WizardShell key={step} title="Create New Goal" progress={1 / 3} onBack={goBack} footer={null}>
        <h2 className="text-2xl font-bold mb-6">What is your goal?</h2>
        <div className="space-y-3">
          <WizardOption
            icon={<TrendingDown className="w-4 h-4" strokeWidth={2} />}
            title="Lose Weight"
            description=""
            selected={goalType === "cut"}
            onSelect={() => selectGoalType("cut")}
          />
          <WizardOption
            icon={<Equal className="w-4 h-4" strokeWidth={2} />}
            title="Maintain Weight"
            description=""
            selected={goalType === "maintain"}
            onSelect={() => selectGoalType("maintain")}
          />
          <WizardOption
            icon={<TrendingUp className="w-4 h-4" strokeWidth={2} />}
            title="Gain Weight"
            description=""
            selected={goalType === "bulk"}
            onSelect={() => selectGoalType("bulk")}
          />
        </div>
      </WizardShell>
    );
  }

  if (step === "target") {
    const displayWeight = goalWeightKg !== null ? kgToUnit(goalWeightKg, unit) : trendWeightKg !== null ? kgToUnit(trendWeightKg, unit) : 70;
    const isStandardRate = isWithinRecommendedRange(rateKgPerWeek, goalType, trendWeightKg);
    const recommendedRange = recommendedRateRangeKgPerWeek(goalType, trendWeightKg);
    const { min: rateMin, max: rateMax } = rateSliderBoundsKgPerWeek(goalType, trendWeightKg);
    const weightBoundsKg = weightSliderBoundsKg(goalType, trendWeightKg);
    const monthlyRateKg = rateKgPerWeek * 4.345;
    // Two independent reasons to speak up, sharing one line of UI because
    // they'd never both be worth two. The rate itself is never constrained by
    // either — see DEEP_DEFICIT_FRACTION's own comment on why an advisory
    // beats a clamp.
    const deficitFraction = impliedDeficitFraction(rateKgPerWeek, previewTdee);
    const isDeepDeficit = deficitFraction !== null && deficitFraction > DEEP_DEFICIT_FRACTION;
    // An *absent* "Standard (Recommended)" badge is not a warning — the pill
    // above goes `invisible` outside the range and says nothing, so before
    // this there was no point at which choosing an aggressive rate produced a
    // single word about it.
    // "Outside recommended" only means faster here. A deliberately slower
    // rate is not a risk warning, and describing it as "faster" was plainly
    // wrong for the near-maintenance end of a cut slider.
    const isFasterThanRecommended = recommendedRange !== null &&
      (goalType === "cut" ? rateKgPerWeek < recommendedRange.min : rateKgPerWeek > recommendedRange.max);
    const monthlyPctBw = weeklyPctBw !== null ? weeklyPctBw * 4.345 : null;

    // The rate band is evidence-based, while the advisory is based on this
    // person's expenditure. Where both are known, green means both things at
    // once: recommended *and* no deeper than the 25% deficit advisory. This
    // prevents a warning from appearing while the thumb is still in green.
    const deepestRateBeforeWarning = previewTdee === null
      ? null
      : -(previewTdee * DEEP_DEFICIT_FRACTION * 7) / 7700;
    const safeRecommendedRange = recommendedRange === null
      ? null
      : goalType === "cut" && deepestRateBeforeWarning !== null
        ? {
            min: Math.max(recommendedRange.min, deepestRateBeforeWarning),
            max: recommendedRange.max,
          }
        : recommendedRange;
    const greenRange = safeRecommendedRange !== null && safeRecommendedRange.min <= safeRecommendedRange.max
      ? safeRecommendedRange
      : null;
    const percentageOfExpenditure = deficitFraction === null
      ? null
      : `${Math.round(Math.abs(deficitFraction) * 100)}% ${deficitFraction >= 0 ? "deficit" : "surplus"}`;

    return (
      <WizardShell key={step} title={mode === "new" ? "Create New Goal" : "Edit Goal"} progress={mode === "new" ? 2 / 3 : 1 / 2} onBack={goBack} footer={
        <button onClick={() => setStep("summary")} className="w-full py-3.5 rounded-full text-sm font-semibold" style={{ background: "#ECEDEE", color: "#0B1210" }}>
          Next
        </button>
      }>
        <div className="grid grid-cols-2 gap-3 mb-6 items-stretch">
          <div className="rounded-md p-3" style={{ background: "rgba(5,150,105,0.15)" }}>
            <p className="tabular text-lg font-bold whitespace-nowrap">
              {previewTargetCalories !== null ? previewTargetCalories : "—"} <span className="text-xs font-normal text-muted">kcal</span>
            </p>
            <p className="text-[11px] text-muted mt-0.5">initial daily budget</p>
          </div>
          {/* Abbreviated month (formatShortDate, not formatFullDate) plus
              whitespace-nowrap — this card is half the row width, and the
              full month name routinely wrapped to a second line there,
              pushing the rest of the screen down as the slider moved.
              overflow-hidden/text-ellipsis is just a safety net for any
              locale whose short format still runs long. */}
          <div className="rounded-md p-3 bg-surface-raised min-w-0">
            <p className="text-lg font-bold whitespace-nowrap overflow-hidden text-ellipsis">
              {previewEndDate ? formatShortDate(previewEndDate) : "—"}
            </p>
            <p className="text-[11px] text-muted mt-0.5">projected end date</p>
          </div>
        </div>

        <h2 className="text-xl font-bold mb-4">What is your target weight?</h2>
        <p className="text-center tabular text-3xl font-bold mb-3">
          {displayWeight.toFixed(1)} <span className="text-base font-normal text-muted">{unit}</span>
        </p>
        {/* data-no-rubber-band: same reason as the Compare screen's slider —
            a horizontal drag always carries a little vertical wobble, which
            was enough to arm useRubberBandScroll's pull gesture (and its
            preventDefault) on top of the thumb drag, making the slider feel
            stuck mid-gesture. */}
        <div data-no-rubber-band>
          <input
            type="range"
            min={kgToUnit(weightBoundsKg.min, unit)}
            max={kgToUnit(weightBoundsKg.max, unit)}
            step={0.1}
            value={displayWeight}
            onChange={(e) => setGoalWeightKg(unitToKg(Number(e.target.value), unit))}
            className="w-full accent-ink mb-8"
          />
        </div>

        <h2 className="text-xl font-bold mb-1">What is your target goal rate?</h2>
        <p
          className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full mb-3 ${isStandardRate && !isDeepDeficit ? "" : "invisible"}`}
          style={{ background: "rgba(5,150,105,0.2)", color: "#059669" }}
        >
          Standard (Recommended)
        </p>
        <RecommendedRangeSlider
          value={rateKgPerWeek}
          min={rateMin}
          max={rateMax}
          step={0.05}
          range={greenRange}
          onChange={setRateKgPerWeek}
        />
        <p className="text-center text-xs font-medium text-muted -mt-0.5 mb-1" aria-live="polite">
          {percentageOfExpenditure !== null
            ? `About a ${percentageOfExpenditure} of your daily expenditure`
            : "Deficit or surplus percentage will appear after your first expenditure estimate"}
        </p>
        <div className="grid grid-cols-3 gap-2 text-center text-xs mt-4">
          <RateStatTile
            label="per week"
            displayValue={`${rateKgPerWeek >= 0 ? "+" : ""}${kgToUnit(rateKgPerWeek, unit).toFixed(2)} ${unit}`}
            editSeed={kgToUnit(rateKgPerWeek, unit)}
            onCommit={(v) => setRateKgPerWeek(clamp(unitToKg(v, unit), rateMin, rateMax))}
          />
          <RateStatTile
            label="% BW/week"
            displayValue={weeklyPctBw !== null ? `${weeklyPctBw >= 0 ? "+" : ""}${weeklyPctBw.toFixed(2)}%` : "—"}
            editSeed={weeklyPctBw ?? 0}
            disabled={trendWeightKg === null}
            onCommit={(v) => {
              if (trendWeightKg === null) return;
              setRateKgPerWeek(clamp((v / 100) * trendWeightKg, rateMin, rateMax));
            }}
          />
          <RateStatTile
            label="per month"
            displayValue={`${monthlyRateKg >= 0 ? "+" : ""}${kgToUnit(monthlyRateKg, unit).toFixed(1)} ${unit}`}
            editSeed={kgToUnit(monthlyRateKg, unit)}
            onCommit={(v) => setRateKgPerWeek(clamp(unitToKg(v, unit) / 4.345, rateMin, rateMax))}
          />
        </div>

        {(isDeepDeficit || isFasterThanRecommended) && (
          <div className="mt-5 rounded-xl border p-3" style={{ borderColor: "rgba(217,89,38,0.4)" }}>
            <p className="text-xs font-semibold">
              {isDeepDeficit ? `That's a ${Math.round(deficitFraction! * 100)}% deficit` : "Faster than the recommended range"}
            </p>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              {isDeepDeficit && previewTdee !== null && (
                <>
                  You burn about {previewTdee} kcal a day, so this rate means eating {Math.round(deficitFraction! * 100)}% under that. Past
                  roughly 25% is where muscle, training quality and simply sticking to it start to suffer.{" "}
                </>
              )}
              {isFasterThanRecommended && recommendedRange !== null && (
                <>
                  The evidence supports {Math.abs(kgToUnit(recommendedRange.max, unit)).toFixed(2)}–
                  {Math.abs(kgToUnit(recommendedRange.min, unit)).toFixed(2)} {unit} per week for a {goalType}; beyond that, more of what
                  you lose tends to be muscle rather than fat.{" "}
                </>
              )}
              We'll set exactly the rate you pick — this is so you're picking it knowingly, not a limit.
            </p>
          </div>
        )}
      </WizardShell>
    );
  }

  // step === "summary"
  const saving = mode === "new" ? createGoal.isPending : editGoal.isPending;
  const isNoChangeWeight = mode === "edit" && activeGoal?.goalWeightKg === goalWeightKg;
  const isNoChangeRate = mode === "edit" && activeGoal?.targetRateKgPerWeek === rateKgPerWeek;

  return (
    <WizardShell
      key={step}
      title={mode === "new" ? "Create New Goal" : "Edit Goal"}
      progress={1}
      onBack={goBack}
      footer={
        <button
          onClick={saveGoal}
          disabled={saving}
          className="w-full py-3.5 rounded-full text-sm font-semibold disabled:opacity-50"
          style={{ background: "#ECEDEE", color: "#0B1210" }}
        >
          {saving ? "Saving…" : "Done"}
        </button>
      }
    >
      <h2 className="text-xl font-bold mb-4">{mode === "new" ? "Goal summary" : "Edits to your goal"}</h2>
      <div className="space-y-3">
        <div className="rounded-md p-4" style={{ background: "rgba(5,150,105,0.15)" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{goalType === "cut" ? "Weight Loss" : goalType === "bulk" ? "Weight Gain" : "Maintain Weight"}</span>
            {goalWeightKg !== null && trendWeightKg !== null && (
              <span className="tabular text-sm">
                {kgToUnit(trendWeightKg, unit).toFixed(1)} {unit} » {kgToUnit(goalWeightKg, unit).toFixed(1)} {unit}
              </span>
            )}
          </div>
          {mode === "edit" && <p className="text-xs text-muted mt-2">{isNoChangeWeight ? "No Change" : "Updated"}</p>}
        </div>

        {goalType !== "maintain" && (
          <div className="rounded-md bg-surface-raised overflow-hidden">
            <div className="flex items-center justify-between p-4">
              <span className="text-sm font-semibold">Goal Rate</span>
              <span className="tabular text-sm">
                {rateKgPerWeek >= 0 ? "+" : ""}
                {weeklyPctBwText(rateKgPerWeek, trendWeightKg)} BW per week
              </span>
            </div>
            <div className="px-4 pb-4">
              <p className="text-xs text-muted">
                {mode === "edit"
                  ? isNoChangeRate
                    ? "No Change"
                    : "Updated"
                  : "We will adjust your calorie targets as needed to keep you on track. The exact amount you gain or lose each week will change as your overall body weight changes."}
              </p>
            </div>
          </div>
        )}

        {previewTargetCalories !== null && (
          <div className="rounded-md bg-surface-raised overflow-hidden">
            <div className="flex items-center justify-between p-4">
              <span className="text-sm font-semibold">Initial Daily Budget</span>
              <span className="tabular text-sm">{previewTargetCalories} kcal</span>
            </div>
            <div className="px-4 pb-4">
              <p className="text-xs text-muted">
                This daily budget is estimated based on your current expenditure. Each check-in adjusts your plan to reflect your new daily budget.
              </p>
            </div>
          </div>
        )}

        {previewEndDate && (
          <div className="rounded-md bg-surface-raised overflow-hidden">
            <div className="flex items-center justify-between p-4">
              <span className="text-sm font-semibold">Estimated End Date</span>
              <span className="tabular text-sm">{formatFullDate(previewEndDate)}</span>
            </div>
            <div className="px-4 pb-4">
              <p className="text-xs text-muted">
                An optimistic estimate of when you'd reach your goal if your expenditure stayed stable and you hit your targets consistently.
              </p>
            </div>
          </div>
        )}
      </div>
    </WizardShell>
  );
}

function weeklyPctBwText(rateKgPerWeek: number, trendWeightKg: number | null): string {
  if (!trendWeightKg) return "—";
  const pct = (rateKgPerWeek / trendWeightKg) * 100;
  return `${pct.toFixed(2)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// A native range input with a highlighted "recommended zone" band drawn on
// its track (the MacroFactor-style rate slider) — the native input's own
// track/thumb are neutralized (appearance-none + transparent pseudo-element
// track) and drawn as two decorative absolutely-positioned bars underneath
// instead, since accent-color's built-in fill-from-edge behavior can't
// represent an arbitrary highlighted sub-range. The input itself keeps all
// native drag/keyboard/touch behavior — only its paint is replaced.
function RecommendedRangeSlider({
  value,
  min,
  max,
  step,
  range,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  range: { min: number; max: number } | null;
  onChange: (v: number) => void;
}) {
  const pct = (v: number) => clamp(((v - min) / (max - min)) * 100, 0, 100);

  // data-no-rubber-band: see the target-weight slider above — same fix,
  // same reason.
  return (
    <div data-no-rubber-band className="relative h-8">
      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-surface-raised" />
      {range && (
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-goal/50"
          style={{ left: `${pct(range.min)}%`, width: `${pct(range.max) - pct(range.min)}%` }}
        />
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="relative z-10 w-full h-8 appearance-none bg-transparent cursor-pointer focus:outline-none
          [&::-webkit-slider-runnable-track]:appearance-none [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-1.5
          [&::-moz-range-track]:bg-transparent [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:border-0
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:-mt-[7px]
          [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-ink [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:shadow"
      />
    </div>
  );
}

// One of the three rate stat tiles (per week / % BW per week / per month) —
// tap to type an exact value in that tile's own unit instead of dragging the
// slider. editSeed is the numeric value (already in the unit this tile
// displays) to prefill the input with.
function RateStatTile({
  label,
  displayValue,
  editSeed,
  disabled,
  onCommit,
}: {
  label: string;
  displayValue: string;
  editSeed: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");

  function commit() {
    const parsed = Number(input);
    if (input !== "" && !Number.isNaN(parsed)) onCommit(parsed);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-md bg-surface-raised p-2 min-h-[52px] flex flex-col justify-center">
        <DecimalInput
          label={label}
          value={input}
          onChange={setInput}
          allowNegative
          autoOpen
          onDone={commit}
          className="tabular font-semibold w-full bg-transparent text-center focus:outline-none"
        />
        <p className="text-muted mt-0.5">{label}</p>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        setInput(editSeed.toFixed(2));
        setEditing(true);
      }}
      className="rounded-md bg-surface-raised p-2 min-h-[52px] flex flex-col justify-center disabled:opacity-50"
    >
      <p className="tabular font-semibold">{displayValue}</p>
      <p className="text-muted mt-0.5">{label}</p>
    </button>
  );
}
