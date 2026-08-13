import { useEffect, useMemo, useState } from "react";
import BottomSheet from "./BottomSheet";
import DecimalInput from "./DecimalInput";
import { useDayLog } from "../api/logs";
import { usePrograms } from "../api/programs";
import { useCreateEventPlan, usePreviewEventPlan, type PlanInput } from "../api/eventPlans";
import { targetsForDate } from "../lib/programTargets";
import { addDays, formatDayLabel, localDateString } from "../lib/date";
import { useEnergyUnit, formatEnergy, kcalToUnit, unitToKcal } from "../lib/energyUnit";
import { ApiError } from "../api/client";

const MAX_SPREAD_DAYS = 7;
const DATE_CHOICES = 14;

// How far over target a planned event is assumed to run before the user says
// otherwise. Only a starting point for the estimate field — it's their number,
// and the whole feature rests on them having a better sense of it than any
// default could.
const DEFAULT_SURPLUS_KCAL = 500;

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl bg-dashboardCard p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg py-2 text-xs font-medium transition-colors ${
            value === o.value ? "bg-accent text-white" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function EventPlanSheet({ onClose }: { onClose: () => void }) {
  const today = localDateString();
  const [kind, setKind] = useState<"planned" | "recovery">("planned");
  const [eventDate, setEventDate] = useState(addDays(today, 1));
  const [label, setLabel] = useState("");
  const [kcalText, setKcalText] = useState("");
  const [windowMode, setWindowMode] = useState<"spread" | "week">("spread");
  const [spreadDays, setSpreadDays] = useState(3);
  const [error, setError] = useState<string | null>(null);

  const programs = usePrograms();
  const preview = usePreviewEventPlan();
  const create = useCreateEventPlan();
  const { unit: energyUnit } = useEnergyUnit();
  // Only meaningful in recovery mode, where the day already happened and its
  // real total is a better starting number than any guess.
  const eventDayLog = useDayLog(eventDate);

  const baseTargets = targetsForDate(programs.data ?? [], eventDate);

  // Dates offered: forward for a planned event, backward for a recovery. A
  // recovery for *today* is allowed — the day is logged and you can still
  // change tomorrow.
  const dateChoices = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < DATE_CHOICES; i++) {
      out.push(kind === "planned" ? addDays(today, i) : addDays(today, -i));
    }
    return out;
  }, [kind, today]);

  // Switching mode invalidates the chosen date (a past date can't host a
  // planned event, and vice versa), so re-anchor rather than leaving a date
  // the other mode can't use.
  useEffect(() => {
    setEventDate(kind === "planned" ? addDays(today, 1) : today);
  }, [kind, today]);

  // Seed the estimate: the day's real total for a recovery, target + a
  // typical surplus for a planned event. Only ever fills a blank field —
  // retyping the number the user just entered would be maddening.
  useEffect(() => {
    if (kcalText !== "") return;
    if (kind === "recovery") {
      const actual = eventDayLog.data?.totals.calories;
      if (actual) setKcalText(String(Math.round(kcalToUnit(actual, energyUnit))));
      return;
    }
    if (baseTargets) setKcalText(String(Math.round(kcalToUnit(baseTargets.calories + DEFAULT_SURPLUS_KCAL, energyUnit))));
  }, [kind, eventDate, eventDayLog.data, baseTargets, energyUnit, kcalText]);

  // Re-seed when the day changes, since the previous day's number is no
  // longer the right starting point.
  useEffect(() => {
    setKcalText("");
  }, [eventDate, kind]);

  // The field is typed in whatever unit the user displays; the API — like
  // every other stored number in this app — is kcal. Convert at this
  // boundary, never persist a converted value.
  const eventKcal = unitToKcal(Number(kcalText), energyUnit);
  const input: PlanInput | null =
    Number.isFinite(eventKcal) && eventKcal > 0
      ? { eventDate, label: label.trim() || null, kind, eventKcal, windowMode, spreadDays }
      : null;

  // Preview runs on every meaningful change: it's the same pure calculation
  // the commit path re-runs, so what's shown here is what gets written.
  useEffect(() => {
    if (!input) return;
    preview.mutate(input);
    // preview is a stable mutation object; depending on it would loop.
  }, [eventDate, label, kind, eventKcal, windowMode, spreadDays]);

  const result = preview.data ?? null;
  const noProgram = preview.error instanceof ApiError && preview.error.message.includes("no_active_program");

  function submit() {
    if (!input) return;
    setError(null);
    create.mutate(input, {
      onSuccess: onClose,
      onError: (err) =>
        setError(err instanceof ApiError ? "Couldn't save that plan — try again." : "Couldn't save that plan — try again."),
    });
  }

  const offsetDays = result?.days.filter((d) => d.date !== eventDate) ?? [];

  return (
    <BottomSheet
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-h-[90%] bg-dashboardBg rounded-t-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
    >
      {(dragHandlers) => (
        <>
          <div {...dragHandlers} className="px-4 pt-1 pb-2 flex items-center shrink-0 touch-none">
            <span className="text-sm font-medium text-white">Plan a Big Day</span>
          </div>
          <div className="px-4 pb-4 overflow-y-auto space-y-4">
            <Segmented
              value={kind}
              onChange={setKind}
              options={[
                { value: "planned", label: "Coming up" },
                { value: "recovery", label: "Already happened" },
              ]}
            />

            <div>
              <p className="text-[11px] tracking-widest uppercase text-muted pb-2">
                {kind === "planned" ? "Which day?" : "Which day went over?"}
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {dateChoices.map((d) => (
                  <button
                    key={d}
                    onClick={() => setEventDate(d)}
                    className={`shrink-0 rounded-xl px-3 py-2 text-xs whitespace-nowrap border ${
                      d === eventDate ? "border-accent bg-accent/15 text-white" : "border-line text-muted"
                    }`}
                  >
                    {formatDayLabel(d)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] tracking-widest uppercase text-muted pb-2">What is it? (optional)</p>
              <div className="rounded-xl border border-line bg-dashboardCard px-3 py-2 focus-within:border-accent">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Dinner with friends"
                  maxLength={80}
                  className="w-full bg-transparent text-sm text-white placeholder:text-muted focus:outline-none"
                />
              </div>
            </div>

            <div>
              <p className="text-[11px] tracking-widest uppercase text-muted pb-2">
                {kind === "planned" ? "Roughly what will you eat?" : "What did you eat?"}
              </p>
              <DecimalInput
                value={kcalText}
                onChange={setKcalText}
                label={kind === "planned" ? "Estimated intake" : "Actual intake"}
                allowDecimal={false}
                className="w-full rounded-xl border border-line bg-dashboardCard px-3 py-2.5 text-sm tabular text-left focus:outline-none focus:border-accent"
              />
              {baseTargets && (
                <p className="text-[11px] text-muted pt-1.5">
                  Your usual target for that day is {formatEnergy(baseTargets.calories, energyUnit)}.
                </p>
              )}
            </div>

            {kind === "planned" && (
              <div>
                <p className="text-[11px] tracking-widest uppercase text-muted pb-2">Spread across</p>
                <Segmented
                  value={windowMode}
                  onChange={setWindowMode}
                  options={[
                    { value: "spread", label: "Days either side" },
                    { value: "week", label: "Rest of the week" },
                  ]}
                />
              </div>
            )}

            {(windowMode === "spread" || kind === "recovery") && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/80">
                  {kind === "recovery" ? "Days to recover over" : "Days either side"}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSpreadDays((n) => Math.max(1, n - 1))}
                    className="w-8 h-8 rounded-full border border-line text-muted text-lg leading-none"
                  >
                    −
                  </button>
                  <span className="tabular text-sm w-4 text-center">{spreadDays}</span>
                  <button
                    onClick={() => setSpreadDays((n) => Math.min(MAX_SPREAD_DAYS, n + 1))}
                    className="w-8 h-8 rounded-full border border-line text-muted text-lg leading-none"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {noProgram && (
              <p className="text-xs text-muted text-center py-4">
                You need an active program before a day can be re-targeted.
              </p>
            )}

            {result && !noProgram && (
              <div className="rounded-2xl bg-dashboardCard px-4 py-3.5 space-y-2">
                {result.surplusKcal <= 0 ? (
                  <p className="text-xs text-muted">
                    That's at or under your usual target for the day — nothing to spread.
                  </p>
                ) : (
                  <>
                    {kind === "planned" && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white/80">{formatDayLabel(eventDate)}</span>
                        <span className="tabular text-white font-medium">
                          +{formatEnergy(result.surplusKcal, energyUnit)}
                        </span>
                      </div>
                    )}
                    {offsetDays.map((d) => (
                      <div key={d.date} className="flex items-center justify-between text-sm">
                        <span className="text-muted">{formatDayLabel(d.date)}</span>
                        <span className="tabular text-muted">
                          −{formatEnergy(Math.abs(d.kcalDelta), energyUnit)}
                        </span>
                      </div>
                    ))}
                    {offsetDays.length === 0 && (
                      <p className="text-xs text-muted">
                        No days left to recover into — try a wider spread, or a day further out.
                      </p>
                    )}
                    {result.shortfallKcal > 0 && offsetDays.length > 0 && (
                      <p className="text-[11px] text-fat pt-1">
                        Only {formatEnergy(result.recoveredKcal, energyUnit)} of{" "}
                        {formatEnergy(result.surplusKcal, energyUnit)} fits in this window — the rest stays on
                        your week.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {error && <p className="text-xs text-protein">{error}</p>}

            <button
              onClick={submit}
              disabled={create.isPending || !result || result.surplusKcal <= 0 || offsetDays.length === 0}
              className="w-full rounded-2xl bg-accent text-white text-sm font-medium py-3 active:opacity-80 disabled:opacity-50"
            >
              {create.isPending ? "Saving…" : "Create Plan"}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
