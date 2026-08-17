import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, Flame } from "lucide-react";
import { useCheckIn, useCoachStatus, useIgnoreCheckin, usePreviewCheckIn, type CheckInPreview, type CheckinTargetChanges } from "../api/coach";
import { useEnergyUnit, energyUnitLabel, formatEnergy, kcalToUnit, type EnergyUnit } from "../lib/energyUnit";
import { useWeightUnit, formatRate } from "../lib/weightUnit";
import { useBackDismiss } from "../lib/useBackDismiss";
import { useHideBottomNav, useHideShortcutsBar } from "../lib/navVisibility";
import { staggerStyle } from "../lib/stagger";
import OrbitLoadingAnimation from "./OrbitLoadingAnimation";
import WeeklyProgramGrid from "./WeeklyProgramGrid";

// The weekly check-in as a full-screen moment rather than a bottom sheet: run
// the check-in behind the orbit illustration, then *land* its headline number —
// the change to your daily Calorie target — before revealing everything that
// moved underneath it. The sheet this replaced said the same things in the same
// order; it just had no beat where the one number that matters is the only
// thing on screen.
//
// Nothing here is committed until you say so. The screen opens on
// POST /api/checkins/preview, which computes the whole check-in and writes no
// rows; Accept then re-runs it for real via POST /api/checkins. Declining is
// POST /api/checkins/ignore — the very same "silence this cycle" mechanism as
// the Ignore buttons on Dashboard and Strategy, so there's no separate
// declined state to invent. Closing with X or back is a third, deliberate
// option: decide later, reminders left on.
//
// This owns all three mutations (call sites only decide when to open it) so
// the loading phase and the result can't get out of step across the two
// screens that offer a check-in.

// Must match @keyframes checkin-drop in index.css: the two landings sit at 46%
// and 80% of the animation, and the haptics/impact ring are timed off them.
const DROP_MS = 1150;
const DROP_IMPACT_FRACTIONS = [0.46, 0.8] as const;
// Beat between the number settling and the rest of the page arriving.
const DROP_HOLD_MS = 320;
// The illustration needs long enough to register as a deliberate step. The
// check-in itself always returns well inside this (the whole plan — every DB
// read, the adaptive estimate and a full program regeneration — measures
// ~0.3ms), so this is entirely what sets the pace, not the network.
//
// Was 2400ms. Cut to 1400 on 2026-08-17: at 2400 the first thing that moves
// arrives 2.4s after the tap and the detail lands near 4s, which is a long
// time to hold someone still for a number that was ready immediately. It also
// straddled OrbitLoadingAnimation's 1800ms status-line cadence, so the second
// line flashed up for 600ms and was cut off mid-read; 1400 shows exactly one
// line, steadily. The drop itself (DROP_MS) is deliberately untouched — that's
// the moment worth having, not the wait in front of it.
const MIN_WORKING_MS = 1400;
const MIN_WORKING_MS_REDUCED = 700;

const STATUS_LINES = [
  "Reading your weight trend…",
  "Totalling your logged Calories…",
  "Re-estimating your expenditure…",
  "Refreshing your targets…",
];

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Phase = "working" | "drop" | "details";

export default function CheckInFlow({ onClose }: { onClose: () => void }) {
  const preview = usePreviewCheckIn();
  const checkIn = useCheckIn();
  const ignoreCheckin = useIgnoreCheckin();
  const status = useCoachStatus();
  const { unit } = useEnergyUnit();
  const [phase, setPhase] = useState<Phase>("working");
  const [result, setResult] = useState<CheckInPreview | null>(null);
  const [minWorkingElapsed, setMinWorkingElapsed] = useState(false);
  const reduced = useRef(prefersReducedMotion()).current;

  useBackDismiss(true, onClose);
  useHideBottomNav(true);
  useHideShortcutsBar(true);

  // Fired once per mount. The ref guard is what keeps StrictMode's development
  // double-effect from requesting two previews. The minimum-duration timer has
  // to live in its own effect rather than sharing this one: under that same
  // double invoke, the guard would skip the second setup while its cleanup had
  // already cancelled the timer, leaving the illustration spinning forever.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    preview.mutate(undefined, { onSuccess: setResult });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const id = setTimeout(() => setMinWorkingElapsed(true), reduced ? MIN_WORKING_MS_REDUCED : MIN_WORKING_MS);
    return () => clearTimeout(id);
  }, [reduced]);

  // Both gates cleared: land the number, then bring in the detail.
  useEffect(() => {
    if (phase !== "working" || !result || !minWorkingElapsed) return;
    if (reduced) {
      setPhase("details");
      return;
    }
    setPhase("drop");
    // One pattern rather than timers: vibrate(0) then a pause up to each
    // landing, so the taps stay glued to the keyframes even if the main thread
    // stutters mid-animation.
    const [first, second] = DROP_IMPACT_FRACTIONS.map((f) => Math.round(f * DROP_MS));
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([0, first, 18, second - first - 18, 8]);
    }
  }, [phase, result, minWorkingElapsed, reduced]);

  // Separate from the effect above deliberately: that one lists `phase` as a
  // dependency, so holding this timer there would have its own cleanup cancel
  // it on the very state change that started it, and the detail would never
  // arrive.
  useEffect(() => {
    if (phase !== "drop") return;
    const id = setTimeout(() => setPhase("details"), DROP_MS + DROP_HOLD_MS);
    return () => clearTimeout(id);
  }, [phase]);

  const details = phase === "details";
  const failed = preview.isError;
  const deciding = checkIn.isPending || ignoreCheckin.isPending;
  const decisionError = checkIn.error ?? ignoreCheckin.error;

  // Portaled to <body>, and it must stay that way. Both call sites
  // (DashboardScreen, CoachScreen) render this from inside their
  // [data-rubber-band-surface], which index.css gives a *permanent*
  // `will-change: transform` — that establishes a containing block for fixed
  // descendants and a stacking context exactly like a real transform would,
  // always, not just mid-gesture. In place, this "full-screen" overlay was
  // therefore neither: `inset-0` resolved against the page-height surface
  // instead of the viewport, so the docked footer holding Accept/Decline sat
  // ~2,500px down and had to be scrolled to (verified headlessly: a 900px
  // viewport produced a 2,560px overlay), the working-phase illustration
  // centred itself somewhere off-screen so the wait looked like a hang, and
  // z-50 was trapped below the root-level ShortcutsBar's z-30, leaving the
  // shortcut icons floating on top of the check-in. Rendering into <body>
  // puts it back in the viewport's own containing block and stacking context.
  // Same reasoning as DashboardScreen's pull-to-refresh pill.
  return createPortal(
    <div className="fixed inset-0 z-50 bg-dashboardBg flex flex-col">
      <header
        className="shrink-0 flex items-center justify-between px-2 pb-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)" }}
      >
        <span className="w-10" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted">Check-In</p>
        <button onClick={onClose} aria-label="Close" className="w-10 h-10 grid place-items-center text-muted active:opacity-60">
          <X className="w-5 h-5" strokeWidth={2} />
        </button>
      </header>
      {/* An honest progress line: it creeps while the check-in runs and
          completes the moment there's a result to show. */}
      <div className="shrink-0 h-[2px] bg-line/60 mx-4 rounded-full overflow-hidden">
        <div
          className="h-full bg-ink rounded-full transition-[width] ease-out"
          style={{
            width: failed ? "100%" : phase === "working" ? "18%" : "100%",
            transitionDuration: phase === "working" ? `${MIN_WORKING_MS}ms` : "420ms",
            background: failed ? "#D95926" : undefined,
          }}
        />
      </div>

      <div className={`flex-1 min-h-0 ${details ? "overflow-y-auto" : "overflow-hidden"} px-4`}>
        {failed ? (
          <FailureState
            message={preview.error instanceof Error ? preview.error.message : "Couldn't check in."}
            onRetry={() => {
              // Retrying puts the screen back into its working phase — the
              // mutation's own status flips to pending, which is what swaps this
              // state back out for the illustration.
              setMinWorkingElapsed(false);
              setTimeout(() => setMinWorkingElapsed(true), reduced ? MIN_WORKING_MS_REDUCED : MIN_WORKING_MS);
              preview.mutate(undefined, { onSuccess: setResult });
            }}
          />
        ) : phase === "working" || !result ? (
          <div className="h-full flex flex-col justify-center">
            <OrbitLoadingAnimation lines={STATUS_LINES} />
          </div>
        ) : (
          <>
            {/* Collapsing spacer, not a re-parent: during the drop the number
                sits near the middle of the screen, and when the detail arrives
                this shrinks to nothing so the same element rises to the top of
                a normal scrolling page. */}
            <div
              className="transition-[height] duration-500 ease-out"
              style={{ height: details ? 8 : "min(24vh, 190px)" }}
              aria-hidden="true"
            />
            <Hero result={result} unit={unit} reduced={reduced} />
            {details && <Detail result={result} unit={unit} program={status.data?.activeProgram ?? null} />}
          </>
        )}
      </div>

      {details && !failed && result && (
        <div
          className="shrink-0 px-4 pt-2 space-y-2 checkin-drop-fade"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        >
          {decisionError && (
            <p className="text-xs text-red-400 text-center">
              {decisionError instanceof Error ? decisionError.message : "That didn't go through."}
            </p>
          )}
          <button
            onClick={() => ignoreCheckin.mutate(undefined, { onSuccess: onClose })}
            disabled={deciding}
            className="w-full py-3.5 rounded-full text-sm font-semibold bg-surface-raised text-ink disabled:opacity-50"
          >
            {ignoreCheckin.isPending ? "Declining…" : "Decline and Silence"}
          </button>
          <button
            onClick={() => checkIn.mutate(undefined, { onSuccess: onClose })}
            disabled={deciding}
            className="w-full py-3.5 rounded-full text-sm font-semibold disabled:opacity-50"
            style={{ background: "#ECEDEE", color: "#0B1210" }}
          >
            {checkIn.isPending ? "Applying…" : result.targetChanges ? "Accept Program Changes" : "Complete Check-In"}
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}

// What the whole screen is built around. A check-in on a coached, un-hand-edited
// program has one headline: how much your daily Calorie target moved. When there
// are no target changes to report (manual or hand-edited program) the check-in
// still produced one real number — the refreshed expenditure estimate — so that
// takes the slot rather than showing a triumphant zero.
function heroFor(changes: CheckinTargetChanges | null, tdee: number, unit: EnergyUnit) {
  if (!changes) {
    return {
      value: Math.round(kcalToUnit(tdee, unit)).toLocaleString(),
      caption: "Your estimated daily expenditure",
    };
  }
  const delta = Math.round(kcalToUnit(changes.calories.to, unit)) - Math.round(kcalToUnit(changes.calories.from, unit));
  if (delta === 0) return { value: "0", caption: "Your daily Calorie target held steady" };
  return {
    // U+2212 minus, not a hyphen — at this size a hyphen reads as a dash next
    // to tabular digits.
    value: `${delta > 0 ? "+" : "−"}${Math.abs(delta).toLocaleString()}`,
    caption: "Proposed change to your daily Calorie target",
  };
}

function Hero({ result, unit, reduced }: { result: CheckInPreview; unit: EnergyUnit; reduced: boolean }) {
  const { value, caption } = heroFor(result.targetChanges, result.preview.tdee, unit);
  return (
    <div className="relative text-center select-none">
      {/* Ground the landing sits on. Delayed to the first impact keyframe.
          Centered with a negative margin rather than -translate-x-1/2: the
          keyframes animate `transform`, which replaces a translate set by a
          class outright and leaves the line hanging off to the right. */}
      <div
        className="checkin-impact absolute left-1/2 -ml-20 w-40 h-px bg-ink/60 blur-[0.5px]"
        style={{ bottom: "2.5rem", animationDelay: `${Math.round(DROP_IMPACT_FRACTIONS[0] * DROP_MS)}ms` }}
        aria-hidden="true"
      />
      <div className={reduced ? "" : "checkin-drop-fade"}>
        {/* animationDuration is set here rather than in the class so DROP_MS
            stays the single source of truth for the haptics timed against it. */}
        <div className={reduced ? "" : "checkin-drop"} style={{ animationDuration: `${DROP_MS}ms` }}>
          <p className="flex items-baseline justify-center gap-1.5">
            <span className="tabular font-bold tracking-tight leading-none" style={{ fontSize: "clamp(3.25rem, 17vw, 5rem)" }}>
              {value}
            </span>
            <span className="text-xl text-muted font-medium">{energyUnitLabel(unit)}</span>
          </p>
        </div>
      </div>
      <p
        className="text-sm text-muted mt-3 checkin-drop-fade"
        style={{ animationDelay: reduced ? "0ms" : `${Math.round(DROP_IMPACT_FRACTIONS[1] * DROP_MS)}ms`, animationDuration: "320ms" }}
      >
        {caption}
      </p>
    </div>
  );
}

function tdeeSourceSentence(usedAdaptiveTdee: boolean): string {
  return usedAdaptiveTdee
    ? "Your expenditure was calculated from your actual weight trend and logged Calories."
    : "Your expenditure was estimated from your profile using a formula — log more weigh-ins and food to switch to your real numbers.";
}

function Detail({
  result,
  unit,
  program,
}: {
  result: CheckInPreview;
  unit: EnergyUnit;
  program: { days: { dayOfWeek: number; targetCalories: number; targetProteinG: number; targetCarbsG: number; targetFatG: number }[] } | null;
}) {
  const changes = result.targetChanges;
  const { unit: weightUnit } = useWeightUnit();
  const energy = (kcal: number) => formatEnergy(kcal, unit);
  let block = 0;

  return (
    <div className="max-w-md mx-auto pb-4 pt-8 space-y-5">
      <h2 className="tile-enter text-xl font-bold text-center" style={staggerStyle(block++, 70, 8)}>
        {changes ? "Your program update is ready" : "Your check-in is ready"}
      </h2>

      {program && (
        <div className="tile-enter" style={staggerStyle(block++, 70, 8)}>
          <WeeklyProgramGrid
            days={program.days.map((d) => ({
              dayOfWeek: d.dayOfWeek,
              calories: d.targetCalories,
              proteinG: d.targetProteinG,
              carbsG: d.targetCarbsG,
              fatG: d.targetFatG,
            }))}
            unit="kcal"
          />
        </div>
      )}

      {changes ? (
        <div className="tile-enter space-y-1" style={staggerStyle(block++, 70, 8)}>
          <h3 className="text-base font-bold mb-2">What's changing?</h3>
          <ChangeRow
            glyph={<Flame className="w-4 h-4" strokeWidth={2} />}
            color="#749EF4"
            label="Calories"
            from={changes.calories.from}
            to={changes.calories.to}
            format={(v) => Math.round(kcalToUnit(v, unit)).toLocaleString()}
            unitLabel={energyUnitLabel(unit)}
          />
          <ChangeRow glyph="P" color="#EF8D6A" label="Protein" from={changes.proteinG.from} to={changes.proteinG.to} format={(v) => String(Math.round(v))} unitLabel="g" />
          <ChangeRow glyph="F" color="#F7D372" label="Fat" from={changes.fatG.from} to={changes.fatG.to} format={(v) => String(Math.round(v))} unitLabel="g" />
          <ChangeRow glyph="C" color="#5ABC80" label="Carbs" from={changes.carbsG.from} to={changes.carbsG.to} format={(v) => String(Math.round(v))} unitLabel="g" />
          {/* Program days can differ from each other (a shifted distribution),
              so every figure above is the daily average across the week — the
              number the program is actually built around. */}
          <p className="text-xs text-muted pt-2">Daily average across your week. Check the Strategy tab for each day.</p>
          {/* Information, not an objection — these targets are exactly the
              rate that was asked for, and accepting is the right call as often
              as not. It sits with the numbers rather than in "What's next?"
              because a check-in is the moment the depth becomes knowable at
              all: it's the moment expenditure was re-measured. */}
          {changes.deepDeficit && (
            <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "rgba(217,89,38,0.4)" }}>
              <p className="text-xs font-semibold">
                Heads up — that's a {Math.round(changes.deficitFraction * 100)}% deficit
              </p>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                These targets deliver the {formatRate(changes.effectiveRateKgPerWeek, weightUnit)} per week you asked for. They just do it
                by eating {Math.round(changes.deficitFraction * 100)}% under what you burn, and past about 25% is where muscle, training
                quality and sticking to the plan start to suffer. Worth accepting with your eyes open — or easing the goal rate on the
                Strategy tab.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="tile-enter space-y-2" style={staggerStyle(block++, 70, 8)}>
          <p className="text-sm text-muted leading-relaxed">
            Your targets weren't changed — a check-in only refreshes them for a Coached program whose days haven't been hand-edited.
          </p>
          <p className="text-sm text-muted leading-relaxed">{tdeeSourceSentence(result.usedAdaptiveTdee)}</p>
        </div>
      )}

      {/* Only worth its own card alongside a target change — when there are no
          changes the expenditure IS the headline above, and repeating the same
          figure a second time reads as two different numbers at a glance. */}
      {changes && (
        <div className="tile-enter rounded-2xl border border-line bg-surface p-4" style={staggerStyle(block++, 70, 8)}>
          <p className="text-[11px] tracking-widest uppercase text-muted">Estimated Expenditure</p>
          <p className="tabular text-2xl font-semibold mt-1">{energy(result.preview.tdee)}</p>
          <p className="text-xs text-muted mt-1 leading-relaxed">{tdeeSourceSentence(result.usedAdaptiveTdee)}</p>
        </div>
      )}

      <div className="tile-enter" style={staggerStyle(block++, 70, 8)}>
        <h3 className="text-base font-bold mb-2">What's next?</h3>
        {/* Spells out both buttons rather than trusting their labels — "Decline
            and Silence" doesn't say that nothing at all gets recorded, which is
            the part that decides whether you can safely tap it. */}
        <p className="text-xs text-muted leading-relaxed">
          {changes
            ? "Accepting applies these targets from today and records the check-in. Declining keeps your current targets, records nothing, and mutes this cycle's reminders — you can still check in from the Strategy tab whenever you want."
            : "Accepting records this check-in and starts the next cycle. Declining records nothing and mutes this cycle's reminders — you can still check in from the Strategy tab whenever you want."}
        </p>
        <p className="text-xs text-muted leading-relaxed mt-2">
          Either way, keep logging your food and weight: at the next check-in that data gets re-read the same way, so your expenditure
          estimate stays in line with what your body is actually doing.
        </p>
      </div>
    </div>
  );
}

// Before/after on one line with the delta spelled out underneath — a check-in's
// whole point is the move, so the direction gets words rather than only a sign.
function ChangeRow({
  glyph,
  color,
  label,
  from,
  to,
  format,
  unitLabel,
}: {
  glyph: ReactNode;
  color: string;
  label: string;
  from: number;
  to: number;
  format: (value: number) => string;
  unitLabel: string;
}) {
  // Differenced after rounding, so the sentence can never disagree with the two
  // numbers displayed beside it.
  const shown = { from: format(from), to: format(to) };
  const delta = Number(shown.to.replace(/[^\d.-]/g, "")) - Number(shown.from.replace(/[^\d.-]/g, ""));
  const unchanged = delta === 0;
  return (
    <div className="flex items-start gap-3 py-2">
      <span
        className="w-8 h-8 rounded-full shrink-0 grid place-items-center text-xs font-bold"
        style={{ background: `${color}1F`, color }}
        aria-hidden="true"
      >
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">{label}</span>
          <span className="tabular text-sm shrink-0">
            <span className="text-muted">{shown.from}</span>
            <span className="text-muted mx-1">→</span>
            <span className="font-semibold" style={{ color }}>
              {shown.to}
            </span>
          </span>
        </div>
        <p className="text-xs text-muted mt-0.5">
          {unchanged
            ? "No change this week"
            : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta).toLocaleString()} ${unitLabel} per day`}
        </p>
      </div>
    </div>
  );
}

function FailureState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-6">
      <p className="text-sm text-muted">{message}</p>
      <button onClick={onRetry} className="px-6 py-3 rounded-full text-sm font-semibold" style={{ background: "#ECEDEE", color: "#0B1210" }}>
        Try again
      </button>
    </div>
  );
}
