import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useLogWeight, useWeights } from "../api/weights";
import { formatDayLabel, localDateString } from "../lib/date";
import { useWeightUnit, unitToKg } from "../lib/weightUnit";
import CalendarJumpSheet from "./CalendarJumpSheet";
import DecimalKeypad from "./DecimalKeypad";

// Shared by the weight detail page and the global quick-actions sheet — same
// input+button, just reused wherever "log today's weight" needs to appear.
export default function LogWeightInline({ onLogged, autoFocus = false }: { onLogged?: () => void; autoFocus?: boolean }) {
  const { unit } = useWeightUnit();
  const logWeight = useLogWeight();
  const [weightInput, setWeightInput] = useState("");
  const [showBodyFat, setShowBodyFat] = useState(false);
  const [bodyFatInput, setBodyFatInput] = useState("");
  const [activeField, setActiveField] = useState<"weight" | "bodyFat">("weight");
  const [keypadOpen, setKeypadOpen] = useState(autoFocus);
  const [allSelected, setAllSelected] = useState(false);
  const [date, setDate] = useState(localDateString());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const weightDates = useWeights(3650, calendarOpen);
  const isToday = date === localDateString();

  function updateActiveValue(update: (previous: string) => string) {
    if (activeField === "weight") setWeightInput(update);
    else setBodyFatInput(update);
  }

  function openField(field: "weight" | "bodyFat") {
    const value = field === "weight" ? weightInput : bodyFatInput;
    setActiveField(field);
    setKeypadOpen(true);
    setAllSelected(Boolean(value));
  }

  function tapDigit(digit: string) {
    updateActiveValue((previous) => allSelected || previous === "0" ? digit : previous + digit);
    setAllSelected(false);
  }

  function tapDecimal() {
    updateActiveValue((previous) => allSelected || previous === "" ? "0." : previous.includes(".") ? previous : `${previous}.`);
    setAllSelected(false);
  }

  function tapBackspace() {
    updateActiveValue((previous) => allSelected ? "" : previous.slice(0, -1));
    setAllSelected(false);
  }

  function submit() {
    const value = Number(weightInput);
    if (!value || value <= 0) return;
    const bodyFatPercent = showBodyFat && bodyFatInput ? Number(bodyFatInput) : null;
    logWeight.mutate(
      { date, weightKg: unitToKg(value, unit), bodyFatPercent },
      { onSuccess: () => onLogged?.() }
    );
    setWeightInput("");
    setBodyFatInput("");
    setShowBodyFat(false);
    setDate(localDateString());
  }

  return (
    // Wrapping in a form previously tried to defeat Chrome's heuristics, but 
    // single-input forms often get flagged as login forms anyway. We've switched
    // to type="text" and removed the name attribute instead.
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={(e) => {
          setKeypadOpen(false);
          setCalendarOpen(true);
        }}
        className="self-center flex items-center gap-1.5 px-3 py-1 rounded-full border border-line text-xs font-medium text-muted active:border-accent active:text-white"
      >
        <CalendarDays className="w-3 h-3" strokeWidth={2} />
        {formatDayLabel(date)}
      </button>
      <div
        className={`border bg-surface rounded-2xl p-4 flex items-center gap-2 ${
          keypadOpen && activeField === "weight" ? "border-accent" : "border-line"
        }`}
      >
        <button
          type="button"
          onClick={() => openField("weight")}
          aria-label={isToday ? "Log today's weight" : `Log weight for ${formatDayLabel(date)}`}
          aria-expanded={keypadOpen && activeField === "weight"}
          className="flex-1 min-w-0 flex items-center gap-2 text-left"
        >
          <span className="tabular flex-1 min-w-0 flex items-center text-sm">
            {weightInput ? (
              allSelected && activeField === "weight" ? <span className="bg-accent/30 rounded px-0.5 -mx-0.5">{weightInput}</span> : weightInput
            ) : (
              <span className="text-muted">{isToday ? "Log today's weight" : `Log weight for ${formatDayLabel(date)}`}</span>
            )}
            {keypadOpen && activeField === "weight" && <span className="caret-blink w-[2px] h-[1.1em] bg-white ml-1 shrink-0" />}
          </span>
          <span className="text-xs text-muted shrink-0">{unit}</span>
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!weightInput || logWeight.isPending}
          className="shrink-0 px-3 py-1.5 rounded-md bg-accent text-sm font-medium disabled:opacity-40"
          style={{ color: "#0B1210" }}
        >
          Log
        </button>
      </div>
      {showBodyFat ? (
        <button
          type="button"
          onClick={() => openField("bodyFat")}
          aria-label="Body fat percentage"
          aria-expanded={keypadOpen && activeField === "bodyFat"}
          className={`border bg-surface rounded-2xl p-4 flex items-center gap-2 text-left ${
            keypadOpen && activeField === "bodyFat" ? "border-accent" : "border-line"
          }`}
        >
          <span className="tabular flex-1 min-w-0 flex items-center text-sm">
            {bodyFatInput ? (
              allSelected && activeField === "bodyFat" ? <span className="bg-accent/30 rounded px-0.5 -mx-0.5">{bodyFatInput}</span> : bodyFatInput
            ) : (
              <span className="text-muted">Body fat (optional)</span>
            )}
            {keypadOpen && activeField === "bodyFat" && <span className="caret-blink w-[2px] h-[1.1em] bg-white ml-1 shrink-0" />}
          </span>
          <span className="text-xs text-muted shrink-0">%</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setShowBodyFat(true);
            openField("bodyFat");
          }}
          className="self-start text-xs text-muted underline underline-offset-2"
        >
          + Body fat %
        </button>
      )}
      {keypadOpen && (
        <div className="-mx-4 -mb-4 mt-1 border-t border-dashboardDivider/60 px-4 pt-3 pb-4">
          <DecimalKeypad
            onDigit={tapDigit}
            onDecimal={tapDecimal}
            onBackspace={tapBackspace}
          />
        </div>
      )}
      {calendarOpen && (
        <CalendarJumpSheet
          selectedDate={date}
          markedDates={weightDates.data?.map((w) => w.date) ?? []}
          onSelect={setDate}
          onClose={() => setCalendarOpen(false)}
        />
      )}
    </div>
  );
}
