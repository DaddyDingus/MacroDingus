import { useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FlaskConical,
  Bot,
  Hand,
  Scale,
  Droplet,
  Wheat,
  Egg,
  Star,
  AlertTriangle,
  AlignJustify,
  Waves,
  BatteryLow,
  Beef,
  Dumbbell,
  Check,
} from "lucide-react";
import { useCoachStatus } from "../api/coach";
import { useCreateProgram, type DietType, type ProteinLevel, type ProteinBasis, type ProgramBreakdown, type ProgramStyle } from "../api/programs";
import WizardShell from "../components/WizardShell";
import WizardIntroCard from "../components/WizardIntroCard";
import WizardOption from "../components/WizardOption";
import WeeklyProgramGrid from "../components/WeeklyProgramGrid";
import OrbitLoadingAnimation from "../components/OrbitLoadingAnimation";

type Step = "intro" | "style" | "diet" | "floor" | "distribution" | "shiftDays" | "protein" | "manualEntry" | "generating" | "results";

const DIET_LABELS: Record<DietType, string> = { balanced: "Balanced", low_fat: "Low-fat", low_carb: "Low-carb", keto: "Keto" };
const PROTEIN_LABELS: Record<ProteinLevel, string> = { low: "Low", moderate: "Moderate", high: "High", extra_high: "Extra High" };
const SHIFT_DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]; // indexed by dayOfWeek (Sun=0)

export default function ProgramWizardScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = useCoachStatus();

  if (status.isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  const goalId = params.get("goalId") ?? status.data?.activeGoal?.id ?? null;
  if (!goalId) {
    navigate("/strategy", { replace: true });
    return null;
  }

  return <ProgramWizardBody goalId={goalId} />;
}

function ProgramWizardBody({ goalId }: { goalId: string }) {
  const navigate = useNavigate();
  const createProgram = useCreateProgram();
  const status = useCoachStatus();
  const bodyFatPercent = status.data?.bodyFatPercent ?? null;

  const [step, setStep] = useState<Step>("intro");
  const [style, setStyle] = useState<ProgramStyle | null>(null);
  const [dietType, setDietType] = useState<DietType>("balanced");
  const [calorieFloorKcal, setCalorieFloorKcal] = useState(1200);
  const [distributionMode, setDistributionMode] = useState<"even" | "shifted">("even");
  // Default matches the old hardcoded weekend-only behavior — a reasonable
  // starting point the user then adjusts, not a "correct" default. Must stay
  // a non-empty, non-full subset of 0-6 (see distributeShiftedWeek in
  // engine/program.ts) — the "shiftDays" step's Next button enforces that.
  const [shiftedHighDays, setShiftedHighDays] = useState<number[]>([0, 6]);
  const [proteinLevel, setProteinLevel] = useState<ProteinLevel>("moderate");
  const [proteinBasis, setProteinBasis] = useState<ProteinBasis>("total");
  const [manualValues, setManualValues] = useState({ calories: "2000", protein: "150", carbs: "200", fat: "60" });
  const [result, setResult] = useState<{ program: Awaited<ReturnType<typeof createProgram.mutateAsync>>["program"]; breakdown: ProgramBreakdown | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function generateCoached() {
    setStep("generating");
    setError(null);
    createProgram.mutate(
      {
        goalId,
        style: "coached",
        dietType,
        calorieFloorKcal,
        proteinLevel,
        distributionMode,
        shiftedHighDays: distributionMode === "shifted" ? shiftedHighDays : undefined,
        proteinBasis,
      },
      {
        onSuccess: (data) => {
          setResult(data);
          setStep("results");
        },
        onError: (e) => {
          setError(e instanceof Error ? e.message : "Couldn't generate your program.");
          setStep("protein");
        },
      }
    );
  }

  function submitManual() {
    const calories = Number(manualValues.calories) || 0;
    const protein = Number(manualValues.protein) || 0;
    const carbs = Number(manualValues.carbs) || 0;
    const fat = Number(manualValues.fat) || 0;
    const days = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      targetCalories: calories,
      targetProteinG: protein,
      targetCarbsG: carbs,
      targetFatG: fat,
    }));
    setError(null);
    createProgram.mutate(
      { goalId, style: "manual", days },
      {
        onSuccess: () => navigate("/strategy"),
        onError: (e) => setError(e instanceof Error ? e.message : "Couldn't save your program."),
      }
    );
  }

  if (step === "intro") {
    return (
      <WizardIntroCard
        title="New Program"
        illustration="program"
        steps={[{ label: "Set program preferences", description: "This will impact your new macro program", status: "active" }]}
        ctaLabel="Set Program Preferences"
        onClose={() => navigate("/strategy")}
        onCta={() => setStep("style")}
      />
    );
  }

  if (step === "style") {
    return (
      <WizardShell key={step} title="Create New Program" progress={1 / 5} onBack={() => setStep("intro")} footer={
        <button
          onClick={() => setStep(style === "manual" ? "manualEntry" : "diet")}
          disabled={!style}
          className="w-full py-3.5 rounded-full text-sm font-semibold disabled:opacity-40"
          style={{ background: "#ECEDEE", color: "#0B1210" }}
        >
          Next
        </button>
      }>
        <h2 className="text-lg font-bold mb-3">Which program style would you like to use?</h2>
        <div className="space-y-2">
          <WizardOption
            icon={<FlaskConical className="w-4 h-4" strokeWidth={2} />}
            title="Coached"
            description="We'll design your Calorie targets and macro program based on your goal and preferences."
            selected={style === "coached"}
            onSelect={() => setStyle("coached")}
          />
          <WizardOption
            icon={<Bot className="w-4 h-4" strokeWidth={2} />}
            title="Collaborative"
            description="Not yet supported in this app — pick Coached or Manual for now."
            selected={false}
            onSelect={() => {}}
            disabled
          />
          <WizardOption
            icon={<Hand className="w-4 h-4" strokeWidth={2} />}
            title="Manual"
            description="Set your own macro and Calorie targets using manual entry."
            selected={style === "manual"}
            onSelect={() => setStyle("manual")}
          />
        </div>
      </WizardShell>
    );
  }

  if (step === "diet") {
    return (
      <WizardShell key={step} title="Create New Program" progress={2 / 5} onBack={() => setStep("style")} footer={
        <button onClick={() => setStep("floor")} className="w-full py-3.5 rounded-full text-sm font-semibold" style={{ background: "#ECEDEE", color: "#0B1210" }}>
          Next
        </button>
      }>
        <h2 className="text-lg font-bold mb-3">What is your preferred diet?</h2>
        <div className="space-y-2">
          <WizardOption icon={<Scale className="w-4 h-4" strokeWidth={2} />} title="Balanced" description="Standard distribution of carbs and fat." selected={dietType === "balanced"} onSelect={() => setDietType("balanced")} />
          <WizardOption icon={<Droplet className="w-4 h-4" strokeWidth={2} />} title="Low-fat" description="Fat will be reduced to prioritize carb and protein intake." selected={dietType === "low_fat"} onSelect={() => setDietType("low_fat")} />
          <WizardOption icon={<Wheat className="w-4 h-4" strokeWidth={2} />} title="Low-carb" description="Carbs will be reduced to prioritize fat and protein intake." selected={dietType === "low_carb"} onSelect={() => setDietType("low_carb")} />
          <WizardOption icon={<Egg className="w-4 h-4" strokeWidth={2} />} title="Keto" description="Carbs will be very restricted to allow for higher fat intake." selected={dietType === "keto"} onSelect={() => setDietType("keto")} />
        </div>
      </WizardShell>
    );
  }

  if (step === "floor") {
    return (
      <WizardShell key={step} title="Create New Program" progress={3 / 5} onBack={() => setStep("diet")} footer={
        <button onClick={() => setStep("distribution")} className="w-full py-3.5 rounded-full text-sm font-semibold" style={{ background: "#ECEDEE", color: "#0B1210" }}>
          Next
        </button>
      }>
        <h2 className="text-lg font-bold mb-3">What Calorie floor do you prefer?</h2>
        <div className="space-y-2">
          <WizardOption icon={<Star className="w-4 h-4" strokeWidth={2} />} title="Standard Floor" description="Your Calorie recommendations will never go below 1200 kcal." selected={calorieFloorKcal === 1200} onSelect={() => setCalorieFloorKcal(1200)} />
          <WizardOption icon={<AlertTriangle className="w-4 h-4" strokeWidth={2} />} title="Low Floor" description="Your Calorie recommendations will never go below 800 kcal (proceed with caution)." selected={calorieFloorKcal === 800} onSelect={() => setCalorieFloorKcal(800)} />
        </div>
      </WizardShell>
    );
  }

  if (step === "distribution") {
    return (
      <WizardShell key={step} title="Create New Program" progress={4 / 5} onBack={() => setStep("floor")} footer={
        <button
          onClick={() => setStep(distributionMode === "shifted" ? "shiftDays" : "protein")}
          className="w-full py-3.5 rounded-full text-sm font-semibold"
          style={{ background: "#ECEDEE", color: "#0B1210" }}
        >
          Next
        </button>
      }>
        <h2 className="text-lg font-bold mb-3">How would you like to distribute Calorie targets throughout the week?</h2>
        <div className="space-y-2">
          <WizardOption icon={<AlignJustify className="w-4 h-4" strokeWidth={2} />} title="Distribute Evenly" description="Distribute your Calorie targets evenly across all days of the week." selected={distributionMode === "even"} onSelect={() => setDistributionMode("even")} />
          <WizardOption icon={<Waves className="w-4 h-4" strokeWidth={2} />} title="Shift Calorie Targets" description="Pick which days run higher — the rest reduce to compensate, same weekly total either way." selected={distributionMode === "shifted"} onSelect={() => setDistributionMode("shifted")} />
        </div>
      </WizardShell>
    );
  }

  if (step === "shiftDays") {
    const isValid = shiftedHighDays.length >= 1 && shiftedHighDays.length <= 6;
    const toggleDay = (dow: number) =>
      setShiftedHighDays((prev) => (prev.includes(dow) ? prev.filter((d) => d !== dow) : [...prev, dow]));

    return (
      <WizardShell key={step} title="Create New Program" progress={4.5 / 5} onBack={() => setStep("distribution")} footer={
        <button
          onClick={() => setStep("protein")}
          disabled={!isValid}
          className="w-full py-3.5 rounded-full text-sm font-semibold disabled:opacity-40"
          style={{ background: "#ECEDEE", color: "#0B1210" }}
        >
          Next
        </button>
      }>
        <h2 className="text-lg font-bold mb-1">Which days would you like to have higher Calorie targets?</h2>
        <p className="text-xs text-muted mb-4">
          Select each day below — the rest of the week reduces to compensate, so your weekly total stays the same.
        </p>
        <div className="border border-line rounded-md overflow-hidden">
          {SHIFT_DAY_LABELS.map((label, dow) => {
            const selected = shiftedHighDays.includes(dow);
            return (
              <button
                key={dow}
                type="button"
                onClick={() => toggleDay(dow)}
                className={`w-full flex items-center justify-between px-4 py-3 border-b border-line/60 last:border-b-0 text-left ${selected ? "bg-surface-raised" : ""}`}
              >
                <span className={`text-sm ${selected ? "text-accent" : ""}`}>{label}</span>
                <span
                  className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center ${selected ? "bg-accent border-accent" : "border-line"}`}
                >
                  {selected && <Check className="w-3 h-3" style={{ color: "#0B1210" }} strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
        {!isValid && (
          <p className="text-xs text-red-400 text-center mt-3">Select at least one day, and leave at least one day unselected.</p>
        )}
      </WizardShell>
    );
  }

  if (step === "protein") {
    return (
      <WizardShell key={step} title="Create New Program" progress={5 / 5} onBack={() => setStep(distributionMode === "shifted" ? "shiftDays" : "distribution")} footer={
        <div className="space-y-2">
          {error && <p className="text-xs text-red-400 text-center">{error}</p>}
          <button onClick={generateCoached} className="w-full py-3.5 rounded-full text-sm font-semibold" style={{ background: "#ECEDEE", color: "#0B1210" }}>
            Next
          </button>
        </div>
      }>
        <h2 className="text-lg font-bold mb-3">What is your preferred protein intake?</h2>
        <div className="space-y-2">
          <WizardOption icon={<BatteryLow className="w-4 h-4" strokeWidth={2} />} title="Low" description="1.4 g/kg — floor of the ISSN-recommended range for most exercising adults." selected={proteinLevel === "low"} onSelect={() => setProteinLevel("low")} />
          <WizardOption icon={<Egg className="w-4 h-4" strokeWidth={2} />} title="Moderate" description="1.8 g/kg — comfortably above the intake shown to maximize muscle gains." selected={proteinLevel === "moderate"} onSelect={() => setProteinLevel("moderate")} />
          <WizardOption icon={<Beef className="w-4 h-4" strokeWidth={2} />} title="High" description="2.2 g/kg — top of the evidence-backed range for building muscle." selected={proteinLevel === "high"} onSelect={() => setProteinLevel("high")} />
          <WizardOption icon={<Dumbbell className="w-4 h-4" strokeWidth={2} />} title="Extra High" description="2.8 g/kg — within the higher range research supports for preserving muscle in a calorie deficit." selected={proteinLevel === "extra_high"} onSelect={() => setProteinLevel("extra_high")} />
        </div>

        {/* A compact segmented toggle, not two more WizardOption cards — a
            plain binary choice doesn't need the icon+description card
            treatment the 4-way protein level above does, and the saved
            height is exactly what keeps this step on one screen. */}
        <h3 className="text-sm font-semibold mb-2 mt-4">Base protein on</h3>
        <div className="flex rounded-md border border-line overflow-hidden">
          <button
            type="button"
            onClick={() => setProteinBasis("total")}
            className={`flex-1 py-2 text-sm font-medium ${proteinBasis === "total" ? "bg-surface-raised text-accent" : "text-muted"}`}
          >
            Total body weight
          </button>
          <button
            type="button"
            onClick={() => setProteinBasis("lean")}
            disabled={bodyFatPercent === null}
            className={`flex-1 py-2 text-sm font-medium disabled:opacity-40 ${proteinBasis === "lean" ? "bg-surface-raised text-accent" : "text-muted"}`}
          >
            Lean body mass
          </button>
        </div>
        <p className="text-xs text-muted mt-1.5">
          {bodyFatPercent === null
            ? "Log a weigh-in with body fat % to unlock lean body mass."
            : proteinBasis === "lean"
              ? "Applied to your estimated lean mass instead of total weight — closer to typical bodybuilding guidance."
              : "Applied to your full trend weight."}
        </p>
      </WizardShell>
    );
  }

  if (step === "manualEntry") {
    return (
      <WizardShell key={step} title="Create New Program" progress={2 / 2} onBack={() => setStep("style")} footer={
        <div className="space-y-2">
          {error && <p className="text-xs text-red-400 text-center">{error}</p>}
          <button
            onClick={submitManual}
            disabled={createProgram.isPending}
            className="w-full py-3.5 rounded-full text-sm font-semibold disabled:opacity-50"
            style={{ background: "#ECEDEE", color: "#0B1210" }}
          >
            {createProgram.isPending ? "Saving…" : "Done"}
          </button>
        </div>
      }>
        <h2 className="text-lg font-bold mb-1">Set your daily targets</h2>
        <p className="text-xs text-muted mb-3">Applied the same every day — use Edit Program afterward for day-by-day changes.</p>
        <div className="space-y-2">
          {([
            ["calories", "Calories", "kcal"],
            ["protein", "Protein", "g"],
            ["carbs", "Carbs", "g"],
            ["fat", "Fat", "g"],
          ] as const).map(([key, label, unit]) => (
            <div key={key} className="flex items-center justify-between border border-line rounded-md px-4 py-3">
              <span className="text-sm">{label}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  value={manualValues[key]}
                  onChange={(e) => setManualValues((v) => ({ ...v, [key]: e.target.value }))}
                  className="w-20 bg-transparent text-right tabular focus:outline-none"
                />
                <span className="text-xs text-muted">{unit}</span>
              </div>
            </div>
          ))}
        </div>
      </WizardShell>
    );
  }

  if (step === "generating") {
    return (
      <div className="min-h-dvh flex flex-col justify-center px-4">
        <OrbitLoadingAnimation />
      </div>
    );
  }

  // step === "results"
  if (!result) return null;
  const b = result.breakdown;
  return (
    <WizardShell
      key={step}
      title="Create New Program"
      progress={1}
      onBack={() => navigate("/strategy")}
      footer={
        <button onClick={() => navigate("/strategy")} className="w-full py-3.5 rounded-full text-sm font-semibold" style={{ background: "#ECEDEE", color: "#0B1210" }}>
          Done
        </button>
      }
    >
      <h2 className="text-lg font-bold mb-3">Your macro program is ready</h2>
      <WeeklyProgramGrid
        days={result.program.days.map((d) => ({ dayOfWeek: d.dayOfWeek, calories: d.targetCalories, proteinG: d.targetProteinG, carbsG: d.targetCarbsG, fatG: d.targetFatG }))}
        unit="kcal"
      />

      {b && (
        <>
          <h3 className="text-base font-bold mt-5 mb-3">How was your program designed?</h3>
          <div className="space-y-0">
            <ReasoningStep n={1} label="Estimated Expenditure" value={`${b.tdee} kcal`} valueColor="#749EF4">
              Looking back over your nutrition and weight history, we determined that your daily energy expenditure is approximately {b.tdee} kcal.
            </ReasoningStep>
            <ReasoningStep n={2} label="Average Target" value={`${b.flatTargetCalories} kcal`} valueColor="#059669">
              Your goal rate implies a daily average Calorie target of around {b.flatTargetCalories} kcal.
            </ReasoningStep>
            <ReasoningStep n={3} label="Target Protein" value={`${b.proteinPerKgUsed} g/kg`} valueColor="#EF8D6A">
              {b.proteinBasisUsed === "lean" && b.leanBodyMassKg !== null ? (
                <>Given your goal and preferred protein level ({PROTEIN_LABELS[proteinLevel]}), consuming {b.proteinPerKgUsed} g/kg of your estimated {b.leanBodyMassKg} kg lean body mass is the daily average this program targets.</>
              ) : (
                <>Given your goal and preferred protein level ({PROTEIN_LABELS[proteinLevel]}), consuming {b.proteinPerKgUsed} g/kg of body weight is the daily average this program targets.</>
              )}
            </ReasoningStep>
            <ReasoningStep n={4} label="Diet Type" value={DIET_LABELS[dietType]} valueColor="#F7D372" last>
              We distributed your remaining Calorie budget between carbs and fat in accordance with the {DIET_LABELS[dietType]} diet.
            </ReasoningStep>
          </div>

          <h3 className="text-base font-bold mt-5 mb-2">What's Next</h3>
          <p className="text-xs text-muted leading-relaxed">
            We'll monitor your Calorie intake and changes in body weight to refine our estimate of your expenditure. Checking in will adjust
            this program's targets to keep you on track with your goal, unless you've hand-edited a specific day via Edit Program.
          </p>
        </>
      )}
    </WizardShell>
  );
}

function ReasoningStep({
  n,
  label,
  value,
  valueColor,
  children,
  last,
}: {
  n: number;
  label: string;
  value: string;
  valueColor: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="w-7 h-7 rounded-full bg-surface-raised flex items-center justify-center text-xs font-semibold shrink-0">{n}</span>
        {!last && <span className="w-px flex-1 bg-line my-1" />}
      </div>
      <div className="pb-6">
        <p className="text-sm font-semibold">{label}</p>
        <p className="tabular text-sm font-semibold mt-0.5" style={{ color: valueColor }}>
          {value}
        </p>
        <p className="text-xs text-muted mt-1 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}
