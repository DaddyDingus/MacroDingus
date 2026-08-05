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
} from "../lib/goalRateGuidance";
import WizardShell from "../components/WizardShell";
import WizardIntroCard, { type WizardIntroStep } from "../components/WizardIntroCard";
import WizardOption from "../components/WizardOption";
import { useBackDismissDepth } from "../lib/useBackDismiss";
import DecimalInput from "../components/DecimalInput";

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
  const [goalOneDone, setGoalOneDone] = useState(false);
  const [savedGoalId, setSavedGoalId] = useState<string | null>(null);

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
      return clamp(activeGoal.targetRateKgPerWeek, bounds.min, bounds.max);
    }
    return defaultRateKgPerWeek("cut", trendWeightKg);
  });

  const introTitle = mode === "new" ? "New Goal" : "Edit Goal";
  // Only meaningful once the goal edit has actually been saved (goalOneDone)
  // — before that, rateKgPerWeek is still the in-progress edit, not
  // something to judge the active program against yet.
  const programStillValid = goalOneDone && currentProgramStillValid();
  const introSteps: WizardIntroStep[] = [
    {
      label: mode === "new" ? "Set new goal" : "Edit goal",
      description: mode === "new" ? "Choose goal weight and rate of change" : "Modify goal weight and rate of weight change",
      status: goalOneDone ? "done" : "active",
    },
    { label: programStillValid ? "Review program" : "Set new program", status: goalOneDone ? "active" : "pending" },
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

  // Whether the currently active program's targets are still exactly what
  // they'd be if regenerated right now, so there's nothing to actually
  // regenerate:
  //  - A brand new goal (mode 'new') never has this — whatever program was
  //    active belonged to the goal that just got superseded.
  //  - A manual program is immune regardless of what changed: its targets
  //    are hand-entered, never derived from the goal's rate in the first
  //    place (see routes/programs.ts's manual branch).
  //  - A coached program's calorie targets are a function of targetRateKgPerWeek
  //    and nothing else about the goal — generateCoachedProgramDays never
  //    reads goalWeightKg (see engine/program.ts's flatTargetCalories). So
  //    editing only the target weight leaves a coached program exactly
  //    valid too; only a rate change actually invalidates it.
  function currentProgramStillValid(): boolean {
    if (mode !== "edit" || !activeGoal) return false;
    const activeProgram = status.activeProgram;
    if (!activeProgram) return false;
    if (activeProgram.style === "manual") return true;
    return activeGoal.targetRateKgPerWeek === rateKgPerWeek;
  }

  function saveGoal() {
    const input = { goalType, goalWeightKg, targetRateKgPerWeek: rateKgPerWeek };
    if (mode === "new") {
      createGoal.mutate(input, {
        onSuccess: (goal) => {
          setSavedGoalId(goal.id);
          setGoalOneDone(true);
          setStep("intro");
        },
      });
    } else if (activeGoal) {
      editGoal.mutate(
        { id: activeGoal.id, goalWeightKg, targetRateKgPerWeek: rateKgPerWeek },
        {
          onSuccess: (goal) => {
            setSavedGoalId(goal.id);
            setGoalOneDone(true);
            setStep("intro");
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
        ctaLabel={goalOneDone ? (programStillValid ? "Review Program" : "Set New Program") : mode === "new" ? "Set New Goal" : "Edit Goal Parameters"}
        onClose={() => navigate("/strategy")}
        onCta={() => {
          if (goalOneDone && savedGoalId) {
            navigate(programStillValid ? "/strategy/review-program" : `/strategy/new-program?goalId=${savedGoalId}`);
          } else {
            setStep(mode === "new" ? "type" : "target");
          }
        }}
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
    const weeklyPctBw = trendWeightKg ? (rateKgPerWeek / trendWeightKg) * 100 : null;
    const monthlyPctBw = weeklyPctBw !== null ? weeklyPctBw * 4.345 : null;

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
          className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full mb-3 ${isStandardRate ? "" : "invisible"}`}
          style={{ background: "rgba(5,150,105,0.2)", color: "#059669" }}
        >
          Standard (Recommended)
        </p>
        <RecommendedRangeSlider
          value={rateKgPerWeek}
          min={rateMin}
          max={rateMax}
          step={0.05}
          range={recommendedRange}
          onChange={setRateKgPerWeek}
        />
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
